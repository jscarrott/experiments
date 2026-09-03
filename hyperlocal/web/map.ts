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

/** What was clicked, for the caller to turn into popup content. */
export type PopupTarget = { kind: 'note'; uri: string } | { kind: 'place'; key: string };

export interface MapCallbacks {
  onMoveEnd(): void;
  /** A business picked out of the tiles, or a bare point when nothing was under the tap. */
  onPick(point: { lat: number; lng: number }, candidate: PlaceCandidate | null): void;
  /**
   * Content for the popup over a clicked pin, or null for no popup. The map asks rather
   * than builds: formatting a note needs handles, relative times and rating labels, none
   * of which belong in a file about maps.
   */
  popupFor(target: PopupTarget): HTMLElement | null;
  /** The draft pin was dragged to a new point. */
  onDraftMove(point: { lat: number; lng: number }): void;
}

export class NoteMap {
  readonly map: MapLibreMap;
  private ready = false;
  private pending: { notes: Note[]; groups: PlaceGroup[] } | null = null;
  private poiLayers: string[] = [];
  private popup: maplibregl.Popup | null = null;
  private draft: maplibregl.Marker | null = null;
  private readonly geolocate: maplibregl.GeolocateControl;

  constructor(container: HTMLElement, callbacks: MapCallbacks, centre: [number, number], zoom: number) {
    this.map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: centre,
      zoom,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // Kept as a field so "Note where I am" can trigger the same control the corner button
    // does, rather than calling navigator.geolocation itself. Going through the control
    // means one permission flow, and the position dot and accuracy ring come for free.
    this.geolocate = new maplibregl.GeolocateControl({
      trackUserLocation: false,
      positionOptions: { enableHighAccuracy: true, timeout: 15_000 },
      showAccuracyCircle: true,
    });
    this.map.addControl(this.geolocate, 'top-right');

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
      // A click that landed on an existing note or place is about reading it, not about
      // starting a new one. Without this, tapping a pin opened its popup and began a
      // fresh draft underneath it at the same time.
      const ours = this.map.queryRenderedFeatures(event.point, {
        layers: ['note-points', 'place-points'].filter((id) => this.map.getLayer(id)),
      });
      if (ours.length > 0) return;

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
      if (typeof uri === 'string') this.openPopup(event.lngLat, callbacks.popupFor({ kind: 'note', uri }));
    });
    this.map.on('click', 'place-points', (event) => {
      const key = event.features?.[0]?.properties?.key;
      if (typeof key === 'string') this.openPopup(event.lngLat, callbacks.popupFor({ kind: 'place', key }));
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
        // A ring, not a disc. The basemap already draws a proper icon for a café or a
        // pub, and painting an opaque circle on top threw that away and replaced it with
        // a dot that says nothing about what the place is. Ours now annotates the
        // basemap's icon rather than hiding it: a coloured ring around it, with a faint
        // tint so it still reads against a busy street at low zoom, where the tiles carry
        // no POI icons at all.
        //
        // The ring is deliberately not much wider than an icon. It has to encircle
        // something whose exact position we do not know — the group sits at the mean of
        // where people tapped, and OsmPlace carries no coordinates of its own — and a
        // larger ring would start covering the neighbouring shops you might want to write
        // about instead.
        'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 13, 8, 22],
        'circle-color': placeCircleColour() as never,
        'circle-opacity': 0.18,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': placeCircleColour() as never,
        'circle-stroke-opacity': 0.95,
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
        'text-offset': [0, 1.9],
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
          // The count used to live only in the circle's radius, which nobody can read off
          // a map. Naming it costs one character of clutter for a place with one note.
          label:
            group.notes.length > 1
              ? `${group.place.name ?? 'Unnamed place'} · ${group.notes.length}`
              : (group.place.name ?? 'Unnamed place'),
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

  /**
   * Show a popup over a pin. Reading a note used to mean looking at the sidebar, which on
   * a phone is inside a closed sheet — so tapping a pin changed something you could not
   * see.
   */
  private openPopup(at: maplibregl.LngLatLike, content: HTMLElement | null): void {
    this.popup?.remove();
    this.popup = null;
    if (!content) return;
    this.popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: '280px',
      offset: 12,
    })
      .setLngLat(at)
      .setDOMContent(content)
      .addTo(this.map);
  }

  closePopup(): void {
    this.popup?.remove();
    this.popup = null;
  }

  /**
   * The pin for the note being written, or null to clear it.
   *
   * Draggable, which is the point: tapping a shopfront on a phone is a coarse gesture,
   * and before this the only feedback that you had hit the wrong side of the street was a
   * pair of decimal numbers in the compose panel.
   */
  setDraft(point: { lat: number; lng: number } | null, onMove: (p: { lat: number; lng: number }) => void): void {
    if (!point) {
      this.draft?.remove();
      this.draft = null;
      return;
    }
    if (!this.draft) {
      this.draft = new maplibregl.Marker({ draggable: true, color: '#5ad1a8' })
        .setLngLat([point.lng, point.lat])
        .addTo(this.map);
      // The geolocate control also creates `.maplibregl-marker` elements for the position
      // dot and its accuracy ring, so the draft pin needs a name of its own.
      this.draft.getElement().dataset.testid = 'draft-pin';
      this.draft.on('dragend', () => {
        const { lat, lng } = this.draft!.getLngLat();
        onMove({ lat, lng });
      });
      return;
    }
    this.draft.setLngLat([point.lng, point.lat]);
  }

  /**
   * Ask the browser where we are.
   *
   * `accuracy` is returned rather than swallowed because it decides whether the answer is
   * worth trusting: indoors it is routinely a hundred metres or more, which is several
   * shops wide, and the person deserves to be told that before they write a review of the
   * wrong one.
   */
  locate(): Promise<{ lat: number; lng: number; accuracy: number }> {
    return new Promise((resolve, reject) => {
      const done = (result: { lat: number; lng: number; accuracy: number }) => {
        this.geolocate.off('geolocate', onFix);
        this.geolocate.off('error', onError);
        this.geolocate.off('outofmaxbounds', onOut);
        resolve(result);
      };
      const onFix = (event: { coords: GeolocationCoordinates }) =>
        done({
          lat: event.coords.latitude,
          lng: event.coords.longitude,
          accuracy: event.coords.accuracy,
        });
      const onError = (event: GeolocationPositionError) => {
        this.geolocate.off('geolocate', onFix);
        this.geolocate.off('error', onError);
        this.geolocate.off('outofmaxbounds', onOut);
        reject(event);
      };
      const onOut = () => onError({ code: 2, message: 'out of bounds' } as GeolocationPositionError);

      this.geolocate.on('geolocate', onFix);
      this.geolocate.on('error', onError);
      this.geolocate.on('outofmaxbounds', onOut);

      // Returns false when the control has not finished setting up, which happens if this
      // is called before the map has loaded.
      if (!this.geolocate.trigger()) {
        onError({ code: 2, message: 'the map is not ready yet' } as GeolocationPositionError);
      }
    });
  }

  /**
   * `offsetY` shifts the target up the screen by that many pixels, for when something is
   * covering the bottom of the map — which on a phone is the note sheet, sitting exactly
   * over the pin you have just been asked to drag.
   */
  flyTo(lat: number, lng: number, zoom?: number, offsetY = 0): void {
    this.map.flyTo({
      center: [lng, lat],
      zoom: zoom ?? Math.max(this.map.getZoom(), 16),
      offset: [0, -offsetY],
    });
  }

  get zoom(): number {
    return this.map.getZoom();
  }

  get centre(): { lat: number; lng: number } {
    const c = this.map.getCenter();
    return { lat: c.lat, lng: c.lng };
  }
}
