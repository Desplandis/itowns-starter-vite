import proj4 from 'proj4';
import {  Color, DepthTexture, LinearFilter, NearestFilter, UnsignedShortType, Vector3, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer';
import { RenderPass } from 'three/addons/postprocessing/RenderPass';
import {
    PlanarView,
    View,
    WMSSource,
    ElevationLayer,
    ColorLayer,
    CopcSource,
    CopcLayer,
    PNTS_SHAPE,
    WFSSource,
    FeatureGeometryLayer,
} from 'itowns';
import GUI from 'lil-gui';

import { PointCloudGUI } from './debug/PointCloudGUI';
import { PlanarGUI } from './debug/TiledGUI';
import { RasterGUI } from './debug/RasterGUI';
import { EDLPass } from './addons/postprocessing/EDLPass';

import type { Extent, PointCloudLayer } from 'itowns';

/**
 * Replace IGN's LiDAR URL by a proxy one due to CORS issues.
 * @param url - COPC URL
 */
function fixUrl(url: string): string {
    return url.replace(
        'https://storage.sbg.cloud.ovh.net/v1/AUTH_63234f509d6048bca3c9fd7928720ca1/ppk-lidar',
        'https://dl-lidar.ign.fr/ppk-lidar'
    );
}

/**
 * Setup a custom render pipeline, including some post-processing effetcs (e.g.
 * Eye-Dome Lighting).
 * @param view The current itowns view
 */
function setupRenderPipeline(view: View) {
    const target = new WebGLRenderTarget(view.camera.width, view.camera.height);
    target.texture.minFilter = LinearFilter;
    target.texture.magFilter = NearestFilter;
    target.depthBuffer = true;
    target.depthTexture = new DepthTexture(view.camera.width, view.camera.height);
    target.depthTexture.type = UnsignedShortType;

    const composer = new EffectComposer(view.renderer as any, target);
    const renderPass = new RenderPass(view.scene as any, view.camera.camera3D as any);
    const edlPass = new EDLPass(
        view.camera3D as any,
        view.camera.width,
        view.camera.height,
    );
    composer.addPass(renderPass);
    composer.addPass(edlPass);

    // @ts-ignore
    view.render = function() {
        composer.render();
    };

    window.addEventListener('resize', () => {
        composer.setSize(viewerDiv.clientWidth, viewerDiv.clientHeight);
    }, false); // TODO
}

function setupView(extent: Extent) {
    console.log(extent);
    const view = new PlanarView(viewerDiv, extent);
    setupRenderPipeline(view);
    return view;
}

function setupRasterLayer(view: PlanarView, extent: Extent, gui?: GUI) {
    // Add a WMS elevation source
    const wmsElevationSource = new WMSSource({
        extent,
        url: 'https://data.geopf.fr/wms-r',
        name: 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES',
        crs: 'EPSG:2154',
        width: 256,
        format: 'image/x-bil;bits=32',
    });

    // Add a WMS elevation layer
    const wmsElevationLayer = new ElevationLayer('wms_elevation', {
        source: wmsElevationSource,
    });

    // Add a WMS imagery source
    const wmsOrthoSource = new WMSSource({
        extent: extent,
        url: 'https://data.geopf.fr/wms-r',
        name: 'ORTHOIMAGERY.ORTHOPHOTOS',
        crs: 'EPSG:2154',
        width: 256,
        format: 'image/png',
    });

    const orthoLayer = new ColorLayer('wms_ortho', {
        source: wmsOrthoSource,
    });

    // Add a WMS plan source
    const wmsPlanSource = new WMSSource({
        extent: extent,
        url: 'https://data.geopf.fr/wms-r',
        name: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
        crs: 'EPSG:2154',
        width: 256,
        format: 'image/png',
        // @ts-ignore
        extent: extent,
    });

    const planLayer = new ColorLayer('wms_plan', {
        source: wmsPlanSource,
    });

    view.addLayer(wmsElevationLayer);
    view.addLayer(planLayer);
    view.addLayer(orthoLayer);

    new RasterGUI(view, orthoLayer, {
        title: "Aerial Imagery",
        parent: gui,
    });

    new RasterGUI(view, planLayer, {
        title: "Plan IGN",
        parent: gui,
    });
}

function buildSource(url: string): Promise<CopcSource> {
    const networkOptions: RequestInit = {
        cache: 'force-cache',
    };

    const source = new CopcSource({
        // @ts-ignore
        networkOptions,
        crs: 'EPSG:2154',
        url: fixUrl(url),
    });

    return source.whenReady;
}

proj4.defs('EPSG:2154', '+proj=lcc +lat_1=45.25 +lat_2=46.75 +lat_0=46 +lon_0=3 +x_0=1700000 +y_0=5200000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const uri = new URL(window.location.href);
const guiState = {
    version() {},
};
const gui = new GUI({
    title: '3D Layers',
});
gui.add(guiState, 'version').name('19/04/2024 Build');

const viewerDiv = document.getElementById('viewerDiv') as HTMLDivElement;
// const mailtoAnchor = document.getElementById('mailto') as HTMLAnchorElement;

// view.mainLoop.gfxEngine.renderer.setClearColor(0xdddddd);

let layer: PointCloudLayer; // COPCLayer
let view: PlanarView;

function onLayerReady(layer: PointCloudLayer) {
    const camera = view.camera.camera3D as any;

    const lookAt = new Vector3();
    const size = new Vector3();
    const root = layer.root;

    root.bbox.getSize(size);
    root.bbox.getCenter(lookAt);

    camera.far = 2.0 * size.length();

    const position = root.bbox.min.clone().add(
        size.multiply({ x: 1, y: 1, z: size.x / size.z }),
    );

    camera.position.copy(position);
    camera.lookAt(lookAt);
    camera.updateProjectionMatrix();

    view.notifyChange(camera);
}

function setUrl(url: string) {
    if (!url) return;

    uri.searchParams.set('copc', url);
    history.pushState(null, '', `?${uri.searchParams.toString()}`);

    // const subject = `[DEMO] Retour sur la visualisation COPC`;

    // const body = `URL de la tuile: ${url}`;

    // mailtoAnchor.href = 'mailto:quentin.bouillaguet@ign.fr?'
    //    + `subject=${subject}`
    //    + `&body=${body}`;

    load(url);
}

async function load(url: string) {
    const source = await buildSource(url);
    view = setupView(source.extent);

    if (layer) {
        view.removeLayer('COPC');
        view.notifyChange();
        layer.delete();
    }

    layer = new CopcLayer('COPC', {
        source,
        crs: view.referenceCrs,
        sseThreshold: 1,
        pointBudget: 3500000,
        material: {
            minAttenuatedSize: 2,
            maxAttenuatedSize: 7,
            shape: PNTS_SHAPE.CIRCLE,
        },
    });

    (layer.material as any).mode = 2;
    const promise: any = View.prototype.addLayer.call(view, layer);
    promise.then(onLayerReady);
    new PointCloudGUI(view, layer, {
        title: layer.id,
        parent: gui,
    });
    const terrainGUI = new PlanarGUI(view, view.tileLayer, {
        title: "Terrain",
        parent: gui,
    });

    setupRasterLayer(view, source.extent, terrainGUI.addFolder('Layers'));
}

const copcParams = uri.searchParams.get('copc');
if (copcParams) {
    setUrl(copcParams);
}
