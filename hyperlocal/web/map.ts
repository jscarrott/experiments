import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
// MapLibre ships its controls unstyled unless this is imported. Without it the zoom and
// geolocate buttons render as bare grey boxes, and — worse — the attribution is not
// positioned at all, so it lays itself across whatever follows the map in the document.
// Nothing errors; it just looks broken in a way that reads as a layout bug.
import 'maplibre-gl/dist/maplibre-gl.css';
import { NOTE_PIN, placeCircleColour } from './map-style.js';
import type { Note, PlaceCandidate, PlaceGroup } from '../shared/types.js';

/**
 * OpenFreeMap's public tiles: no API key, no registration, no usage limit, and
 * MapLibre adds the OpenStreetMap attribution automatically. The Liberty style follows
 * the OpenMapTiles schema, which is what gives us a `poi` source-layer to pick
 * businesses out of.
 */
const STYLE_URL = import.meta.env.VITE_MAP_STYLE ?? 'https://tiles.openfreemap.org/styles/liberty';

const NOTES_SOURCE = 'hyperlocal-notes';
const POI_SOURCE_LAYER = 'poi';

/** The zoom below which the tiles carry no POIs at all, per the OpenMapTiles schema. */
export const POI_MIN_ZOOM = 14;

export interface MapCallbacks {
  onMoveEnd(): void;
  /** A business picked out of the tiles, or a bare point when nothing was under the tap. */
  onPick(point: { lat: number; lng: number }, candidate: PlaceCandidate | null): void;
  onNoteClick(uri: string): void;
  onPlaceClick(key: string): void;
}

export class NoteMap {
  readonly map: MapLibreMap;
  private ready = false;
  private pending: { notes: Note[]; groups: PlaceGroup[] } | null = null;
  private poiLayers: string[] = [];

  constructor(container: HTMLElement, callbacks: MapCallbacks, centre: [number, number], zoom: number) {
    this.map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: centre,
      zoom,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');

    this.map.on('load', () => {
      this.addNoteLayers();
      this.poiLayers = this.map
        .getStyle()
        .layers.filter((l) => 'source-layer' in l && l['source-layer'] === POI_SOURCE_LAYER)
        .map((l) => l.id);
      this.ready = true;
      if (this.pending) {
        this.render(this.pending.notes, this.pending.groups);
        this.pending = null;
      }
    });

    // A style that fails to load must not take the app with it — the sidebar, the
    // filters and the note list are all still useful without a basemap.
    this.map.on('error', (event) => console.warn('[map]', event.error?.message ?? event));

    this.map.on('moveend', () => callbacks.onMoveEnd());

    this.map.on('click', (event: MapMouseEvent) => {
      const { lat, lng } = event.lngLat;
      const features = this.poiLayers.length
        ? this.map.queryRenderedFeatures(event.point, { layers: this.poiLayers })
        : [];
      const poi = features.find((f) => typeof f.properties?.name === 'string');
      callbacks.onPick(
        { lat, lng },
        poi
          ? {
              // The tiles give a name and a class but no stable OSM id — the
              // OpenMapTiles poi schema simply does not carry one. The id comes later,
              // from the proxy, when the compose panel opens.
              name: String(poi.properties!.name),
              category: poi.properties?.class ? String(poi.properties.class) : undefined,
              lat: (poi.geometry as GeoJSON.Point).coordinates[1] ?? lat,
              lng: (poi.geometry as GeoJSON.Point).coordinates[0] ?? lng,
            }
          : null,
      );
    });

    this.map.on('click', 'note-points', (event) => {
      const uri = event.features?.[0]?.properties?.uri;
      if (typeof uri === 'string') callbacks.onNoteClick(uri);
    });
    this.map.on('click', 'place-points', (event) => {
      const key = event.features?.[0]?.properties?.key;
      if (typeof key === 'string') callbacks.onPlaceClick(key);
    });

    for (const layer of ['note-points', 'place-points']) {
      this.map.on('mouseenter', layer, () => (this.map.getCanvas().style.cursor = 'pointer'));
      this.map.on('mouseleave', layer, () => (this.map.getCanvas().style.cursor = ''));
    }
  }

  private addNoteLayers(): void {
    this.map.addSource(NOTES_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // Places first, drawn larger, because a business with four opinions on it is the
    // thing you want to notice before a lone note about a bench.
    this.map.addLayer({
      id: 'place-points',
      type: 'circle',
      source: NOTES_SOURCE,
      filter: ['==', ['get', 'kind'], 'place'],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 9, 8, 18],
        'circle-color': placeCircleColour() as never,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#11131a',
        'circle-opacity': 0.9,
      },
    });
    this.map.addLayer({
      id: 'place-labels',
      type: 'symbol',
      source: NOTES_SOURCE,
      filter: ['==', ['get', 'kind'], 'place'],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#e6e9f0',
        'text-halo-color': '#11131a',
        'text-halo-width': 1.4,
      },
    });
    this.map.addLayer({
      id: 'note-points',
      type: 'circle',
      source: NOTES_SOURCE,
      filter: ['==', ['get', 'kind'], 'note'],
      paint: {
        'circle-radius': 6,
        'circle-color': NOTE_PIN,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#11131a',
      },
    });
  }

  /** Rebuild the whole layer from the derived state. Cheap, and cannot drift. */
  render(notes: Note[], groups: PlaceGroup[]): void {
    if (!this.ready) {
      this.pending = { notes, groups };
      return;
    }
    const source = this.map.getSource(NOTES_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;

    const grouped = new Set(groups.flatMap((g) => g.notes.map((n) => n.uri)));
    const features: GeoJSON.Feature[] = [];

    for (const group of groups) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [group.lng, group.lat] },
        properties: {
          kind: 'place',
          key: group.key,
          label: group.place.name ?? 'Unnamed place',
          count: group.notes.length,
          rated: group.averageRating !== undefined,
          rating: group.averageRating ?? 0,
        },
      });
    }
    // Notes not about a mapped business — a bench, a view, a broken parking meter.
    for (const note of notes) {
      if (grouped.has(note.uri)) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [note.lng, note.lat] },
        properties: { kind: 'note', uri: note.uri },
      });
    }

    source.setData({ type: 'FeatureCollection', features });
  }

  flyTo(lat: number, lng: number, zoom?: number): void {
    this.map.flyTo({ center: [lng, lat], zoom: zoom ?? Math.max(this.map.getZoom(), 16) });
  }

  get zoom(): number {
    return this.map.getZoom();
  }

  get centre(): { lat: number; lng: number } {
    const c = this.map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }
}
