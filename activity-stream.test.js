/**
 * Activity Stream Test Suite
 *
 * Tests for the XanoEventStore class and related activity stream functionality.
 * Run with: node activity-stream.test.js
 */

// Test utilities
let testsPassed = 0;
let testsFailed = 0;
const testResults = [];

function describe(description, fn) {
    console.log(`\n📦 ${description}`);
    fn();
}

function it(description, fn) {
    try {
        fn();
        testsPassed++;
        console.log(`  ✅ ${description}`);
        testResults.push({ description, passed: true });
    } catch (error) {
        testsFailed++;
        console.log(`  ❌ ${description}`);
        console.log(`     Error: ${error.message}`);
        testResults.push({ description, passed: false, error: error.message });
    }
}

function expect(actual) {
    const matchers = {
        toBe(expected) {
            if (actual !== expected) {
                throw new Error(`Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`);
            }
        },
        toEqual(expected) {
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                throw new Error(`Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`);
            }
        },
        toBeTruthy() {
            if (!actual) {
                throw new Error(`Expected truthy value, but got ${JSON.stringify(actual)}`);
            }
        },
        toBeFalsy() {
            if (actual) {
                throw new Error(`Expected falsy value, but got ${JSON.stringify(actual)}`);
            }
        },
        toBeNull() {
            if (actual !== null) {
                throw new Error(`Expected null, but got ${JSON.stringify(actual)}`);
            }
        },
        toContain(expected) {
            if (!actual.includes(expected)) {
                throw new Error(`Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
            }
        },
        toHaveLength(expected) {
            if (actual.length !== expected) {
                throw new Error(`Expected length ${expected}, but got ${actual.length}`);
            }
        },
        toBeGreaterThan(expected) {
            if (actual <= expected) {
                throw new Error(`Expected ${actual} to be greater than ${expected}`);
            }
        },
        toBeLessThan(expected) {
            if (actual >= expected) {
                throw new Error(`Expected ${actual} to be less than ${expected}`);
            }
        },
        toHaveProperty(prop) {
            if (!(prop in actual)) {
                throw new Error(`Expected object to have property "${prop}"`);
            }
        },
        toBeInstanceOf(expected) {
            if (!(actual instanceof expected)) {
                throw new Error(`Expected instance of ${expected.name}`);
            }
        }
    };

    // Add 'not' modifier for negated assertions
    matchers.not = {
        toBe(expected) {
            if (actual === expected) {
                throw new Error(`Expected ${JSON.stringify(actual)} not to be ${JSON.stringify(expected)}`);
            }
        },
        toEqual(expected) {
            if (JSON.stringify(actual) === JSON.stringify(expected)) {
                throw new Error(`Expected ${JSON.stringify(actual)} not to equal ${JSON.stringify(expected)}`);
            }
        }
    };

    return matchers;
}

// Mock ROOMS for testing (simplified version)
const ROOMS = {
    'main-gallery': {
        id: 'main-gallery',
        walls: [
            { id: 'main-gallery:back-1' },
            { id: 'main-gallery:back-2' },
            { id: 'main-gallery:back-3' },
            { id: 'main-gallery:left-1' },
            { id: 'main-gallery:left-2' },
            { id: 'main-gallery:right-1' },
            { id: 'main-gallery:right-2' }
        ]
    },
    'contemporary-wing': {
        id: 'contemporary-wing',
        walls: [
            { id: 'contemporary-wing:north-1' },
            { id: 'contemporary-wing:north-2' },
            { id: 'contemporary-wing:north-3' },
            { id: 'contemporary-wing:west-1' },
            { id: 'contemporary-wing:west-2' },
            { id: 'contemporary-wing:east-1' },
            { id: 'contemporary-wing:east-2' }
        ]
    }
};

// Helper functions from the original code
function generateEventUID() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `evt_${timestamp}_${random}`;
}

function generateObjectId(prefix = 'obj') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
}

function getActorId() {
    return 'test_actor_123';
}

// XanoEventStore class (extracted for testing)
class XanoEventStore {
    constructor() {
        this.events = [];
        this.state = {
            artworks: {},
            rooms: {},
            galleries: {},
            catalogue: {}
        };
        this._fetchInProgress = false;
        this._fetchPromise = null;
        this._postQueue = [];
        this._isProcessingQueue = false;
        this._initialized = false;
        this._lastFetchTime = 0;

        // Performance optimization: Index for O(1) event lookups
        this._eventIndex = new Map();
        this._eventsByObjectId = new Map();

        // Query result cache
        this._queryCache = new Map();
        this._queryCacheVersion = 0;
    }

    _invalidateQueryCache() {
        this._queryCacheVersion++;
        this._queryCache.clear();
    }

    _getCachedQuery(cacheKey, computeFn) {
        const fullKey = `${cacheKey}_v${this._queryCacheVersion}`;
        if (this._queryCache.has(fullKey)) {
            return this._queryCache.get(fullKey);
        }
        const result = computeFn();
        this._queryCache.set(fullKey, result);
        return result;
    }

    _indexEvent(event) {
        if (!event.object_id) return;
        const key = `${event.object_id}|${event.op}|${event.object_type}|${event.verb}`;
        if (!this._eventIndex.has(key)) {
            this._eventIndex.set(key, event);
        }
        if (!this._eventsByObjectId.has(event.object_id)) {
            this._eventsByObjectId.set(event.object_id, []);
        }
        this._eventsByObjectId.get(event.object_id).push(event);
    }

    _rebuildIndexes() {
        this._eventIndex.clear();
        this._eventsByObjectId.clear();
        for (const event of this.events) {
            this._indexEvent(event);
        }
    }

    _normalizeEvent(event) {
        if (!event || typeof event !== 'object') {
            return null;
        }

        let data = event.data;
        if (typeof data === 'string' && data.trim()) {
            try {
                data = JSON.parse(data);
            } catch (e) {
                // Keep original string if it's not valid JSON
            }
        }

        if (!data || typeof data !== 'object') {
            data = {};
        }

        return {
            ...event,
            data,
            verb: event.verb || 'unknown',
            op: event.op || '',
            object_type: event.object_type || 'unknown',
            object_id: event.object_id || ''
        };
    }

    _normalizeArtworkData(data) {
        if (!data || typeof data !== 'object') return data;

        const fieldMap = {
            'image_url': 'imageUrl',
            'gallery_id': 'galleryId',
            'location_id': 'locationId',
            'location_name': 'locationName',
            'room_id': 'roomId',
            'space_id': 'spaceId',
            'room_guid': 'roomGuid',
            'product_url': 'productUrl',
            'height_meters': 'heightMeters',
            'height_inches': 'heightInches',
            'display_mode': 'displayMode',
            'gateway_to': 'gatewayTo',
            'current_image_index': 'currentImageIndex',
            'created_at': 'createdAt',
            'updated_at': 'updatedAt'
        };

        const normalized = { ...data };
        for (const [snakeCase, camelCase] of Object.entries(fieldMap)) {
            if (data[snakeCase] !== undefined && data[camelCase] === undefined) {
                normalized[camelCase] = data[snakeCase];
            }
        }
        return normalized;
    }

    _parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"' && !inQuotes) {
                inQuotes = true;
            } else if (char === '"' && inQuotes) {
                if (nextChar === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else if (char === ',' && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current);

        return values;
    }

    _parseCSV(csvText) {
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) {
            return [];
        }

        const headers = this._parseCSVLine(lines[0]);
        const events = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = this._parseCSVLine(line);
            const event = {};

            headers.forEach((header, index) => {
                event[header] = values[index] || '';
            });

            if (event.data && typeof event.data === 'string') {
                try {
                    event.data = JSON.parse(event.data);
                } catch (e) {
                    // Keep as string if not valid JSON
                }
            }

            events.push(event);
        }

        return events;
    }

    // O(1) optimized version using index
    eventExists(objectId, op, objectType, verb = 'create') {
        const key = `${objectId}|${op}|${objectType}|${verb}`;
        return this._eventIndex.has(key);
    }

    // Optimized: uses object_id index for faster lookup
    _isRecentDuplicate(eventData) {
        const now = Date.now();
        const recentThreshold = 5000;

        const objectEvents = this._eventsByObjectId.get(eventData.object_id);
        if (!objectEvents || objectEvents.length === 0) {
            return false;
        }

        for (let i = objectEvents.length - 1; i >= 0 && i >= objectEvents.length - 10; i--) {
            const e = objectEvents[i];
            if (e.op !== eventData.op) continue;
            if (e.object_type !== eventData.object_type) continue;
            if (e.verb !== eventData.verb) continue;

            const eventTime = new Date(e.created_at || e.published).getTime();
            if ((now - eventTime) < recentThreshold) {
                return true;
            }
        }
        return false;
    }

    reconstructState() {
        this.state = {
            artworks: {},
            rooms: {},
            galleries: {},
            catalogue: {}
        };

        // Rebuild indexes for optimized lookups
        this._rebuildIndexes();

        const getTimestamp = (val) => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') return new Date(val).getTime();
            return 0;
        };
        const sortedEvents = [...this.events].sort((a, b) => {
            const timeA = getTimestamp(a.created_at) || getTimestamp(a.published);
            const timeB = getTimestamp(b.created_at) || getTimestamp(b.published);
            return timeA - timeB;
        });

        for (const event of sortedEvents) {
            this.applyEvent(event);
        }

        // Invalidate query cache
        this._invalidateQueryCache();
    }

    applyEvent(event) {
        const { verb, object_type, object_id } = event;

        let data = event.data;
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (e) {
                data = {};
            }
        }

        if (!data || typeof data !== 'object') {
            data = {};
        }

        if (Object.keys(data).length === 0) {
            const eventMetaKeys = ['id', 'event_uid', 'verb', 'op', 'object_type', 'object_id',
                                  'published', 'created_at', 'updated_at', 'actor_id', 'data', 'frame', 'scale'];
            for (const key of Object.keys(event)) {
                if (!eventMetaKeys.includes(key)) {
                    data[key] = event[key];
                }
            }
        }

        if (!object_type || !object_id) {
            return;
        }

        switch (object_type) {
            case 'artwork':
                this.applyArtworkEvent(verb, object_id, data, event);
                break;
            case 'room':
                this.applyRoomEvent(verb, object_id, data, event);
                break;
            case 'gallery':
                this.applyGalleryEvent(verb, object_id, data, event);
                break;
            case 'catalogue_item':
                this.applyCatalogueEvent(verb, object_id, data, event);
                break;
        }
    }

    applyArtworkEvent(verb, object_id, data, event) {
        const normalizedData = this._normalizeArtworkData(data);

        switch (verb) {
            case 'create':
                this.state.artworks[object_id] = {
                    id: object_id,
                    ...normalizedData,
                    frame: event.frame || normalizedData.frame || 'classic',
                    scale: event.scale || normalizedData.scale || '1',
                    placed: true,
                    spaceId: normalizedData.spaceId || null,
                    roomGuid: normalizedData.roomGuid || null,
                    created_at: event.created_at || event.published
                };
                break;
            case 'update':
                if (this.state.artworks[object_id]) {
                    this.state.artworks[object_id] = {
                        ...this.state.artworks[object_id],
                        ...normalizedData,
                        frame: event.frame || this.state.artworks[object_id].frame,
                        scale: event.scale || this.state.artworks[object_id].scale,
                        spaceId: normalizedData.spaceId !== undefined ? normalizedData.spaceId : this.state.artworks[object_id].spaceId,
                        roomGuid: normalizedData.roomGuid !== undefined ? normalizedData.roomGuid : this.state.artworks[object_id].roomGuid,
                        updated_at: event.created_at || event.published
                    };
                    const artwork = this.state.artworks[object_id];
                    const hasLocation = artwork.locationId || artwork.location || artwork.spaceId;
                    if (!hasLocation) {
                        artwork.placed = false;
                    }
                }
                break;
            case 'delete':
                if (this.state.artworks[object_id]) {
                    this.state.artworks[object_id].placed = false;
                    this.state.artworks[object_id].deleted_at = event.created_at || event.published;
                }
                break;
            case 'place':
                if (this.state.artworks[object_id]) {
                    this.state.artworks[object_id].placed = true;
                    this.state.artworks[object_id].location = normalizedData.location;
                    this.state.artworks[object_id].locationName = normalizedData.locationName;
                    this.state.artworks[object_id].roomId = normalizedData.roomId;
                    if (normalizedData.spaceId) {
                        this.state.artworks[object_id].spaceId = normalizedData.spaceId;
                    }
                    if (normalizedData.roomGuid) {
                        this.state.artworks[object_id].roomGuid = normalizedData.roomGuid;
                    }
                }
                break;
            case 'unplace':
                if (this.state.artworks[object_id]) {
                    this.state.artworks[object_id].placed = false;
                }
                break;
        }
    }

    applyRoomEvent(verb, object_id, data, event) {
        switch (verb) {
            case 'create':
            case 'update':
                this.state.rooms[object_id] = {
                    id: object_id,
                    ...this.state.rooms[object_id],
                    ...data
                };
                break;
            case 'delete':
                delete this.state.rooms[object_id];
                break;
        }
    }

    applyGalleryEvent(verb, object_id, data, event) {
        switch (verb) {
            case 'create':
            case 'update':
                this.state.galleries[object_id] = {
                    id: object_id,
                    ...this.state.galleries[object_id],
                    ...data
                };
                break;
            case 'delete':
                if (this.state.galleries[object_id]) {
                    this.state.galleries[object_id].deleted_at = event.created_at || event.published;
                }
                break;
        }
    }

    applyCatalogueEvent(verb, object_id, data, event) {
        switch (verb) {
            case 'create':
            case 'update':
                this.state.catalogue[object_id] = {
                    id: object_id,
                    ...this.state.catalogue[object_id],
                    ...data,
                    created_at: event.created_at || event.published
                };
                break;
            case 'delete':
                delete this.state.catalogue[object_id];
                break;
        }
    }

    getCatalogueItems() {
        return Object.values(this.state.catalogue);
    }

    getCatalogueItem(objectId) {
        return this.state.catalogue[objectId] || null;
    }

    getPlacedArtworks(galleryId = null) {
        const cacheKey = `placed_${galleryId || 'all'}`;
        return this._getCachedQuery(cacheKey, () => {
            return Object.values(this.state.artworks).filter(artwork => {
                if (!artwork.placed) return false;
                if (galleryId && artwork.galleryId && artwork.galleryId !== galleryId) return false;
                if (galleryId && !artwork.galleryId) return false;
                return true;
            });
        });
    }

    getWallArtworks(galleryId = null) {
        const cacheKey = `wall_${galleryId || 'all'}`;
        return this._getCachedQuery(cacheKey, () => {
            return this.getPlacedArtworks(galleryId).filter(artwork => {
                const location = artwork.locationId || artwork.location;
                if (!location || !artwork.roomId) return false;
                const room = ROOMS[artwork.roomId];
                if (!room) return false;
                return room.walls.some(w => w.id === location);
            });
        });
    }

    getDisplayableArtworks(galleryId = null) {
        const cacheKey = `displayable_${galleryId || 'all'}`;
        return this._getCachedQuery(cacheKey, () => {
            return this.getWallArtworks(galleryId).filter(artwork => {
                if (!artwork.imageUrl) return false;
                return true;
            });
        });
    }

    getFilledSpaceCount(galleryId = null) {
        const cacheKey = `filledCount_${galleryId || 'all'}`;
        return this._getCachedQuery(cacheKey, () => {
            const placedArtworks = this.getPlacedArtworks(galleryId);
            const filledSpaces = new Set();

            placedArtworks.forEach(artwork => {
                const spaceKey = artwork.spaceId || artwork.locationId || artwork.location;
                if (spaceKey) {
                    filledSpaces.add(spaceKey);
                }
            });

            return filledSpaces.size;
        });
    }

    getArtwork(objectId) {
        return this.state.artworks[objectId] || null;
    }

    findDuplicateEvents() {
        const seen = new Map();
        const duplicates = [];

        const sortedEvents = [...this.events].sort((a, b) => {
            const timeA = new Date(a.created_at || a.published).getTime();
            const timeB = new Date(b.created_at || b.published).getTime();
            return timeA - timeB;
        });

        for (const event of sortedEvents) {
            if (event.verb === 'create') {
                const key = `${event.object_id}|${event.op}|${event.object_type}`;
                if (seen.has(key)) {
                    duplicates.push(event);
                } else {
                    seen.set(key, event);
                }
            }
        }

        return duplicates;
    }

    isInitialized() {
        return this._initialized;
    }
}

// ============================================
// TEST SUITES
// ============================================

console.log('🧪 Activity Stream Test Suite');
console.log('=' .repeat(50));

describe('XanoEventStore - Constructor', () => {
    it('should initialize with empty state', () => {
        const store = new XanoEventStore();
        expect(store.events).toHaveLength(0);
        expect(Object.keys(store.state.artworks)).toHaveLength(0);
        expect(Object.keys(store.state.rooms)).toHaveLength(0);
        expect(Object.keys(store.state.galleries)).toHaveLength(0);
        expect(Object.keys(store.state.catalogue)).toHaveLength(0);
    });

    it('should initialize concurrency guards', () => {
        const store = new XanoEventStore();
        expect(store._fetchInProgress).toBe(false);
        expect(store._fetchPromise).toBeNull();
        expect(store._isProcessingQueue).toBe(false);
        expect(store._initialized).toBe(false);
    });
});

describe('XanoEventStore - Event Normalization', () => {
    it('should normalize event with JSON string data', () => {
        const store = new XanoEventStore();
        const event = {
            verb: 'create',
            object_type: 'artwork',
            object_id: 'art_123',
            data: '{"title":"Test Art","price":100}'
        };
        const normalized = store._normalizeEvent(event);
        expect(normalized.data.title).toBe('Test Art');
        expect(normalized.data.price).toBe(100);
    });

    it('should handle event with object data', () => {
        const store = new XanoEventStore();
        const event = {
            verb: 'create',
            object_type: 'artwork',
            object_id: 'art_123',
            data: { title: 'Test Art', price: 100 }
        };
        const normalized = store._normalizeEvent(event);
        expect(normalized.data.title).toBe('Test Art');
    });

    it('should return null for invalid event', () => {
        const store = new XanoEventStore();
        expect(store._normalizeEvent(null)).toBeNull();
        expect(store._normalizeEvent(undefined)).toBeNull();
        expect(store._normalizeEvent('string')).toBeNull();
    });

    it('should add default values for missing fields', () => {
        const store = new XanoEventStore();
        const event = { object_id: 'art_123' };
        const normalized = store._normalizeEvent(event);
        expect(normalized.verb).toBe('unknown');
        expect(normalized.op).toBe('');
        expect(normalized.object_type).toBe('unknown');
    });
});

describe('XanoEventStore - Artwork Data Normalization', () => {
    it('should convert snake_case to camelCase', () => {
        const store = new XanoEventStore();
        const data = {
            image_url: 'http://example.com/img.jpg',
            gallery_id: 'gallery_123',
            location_id: 'loc_456',
            height_meters: 1.5
        };
        const normalized = store._normalizeArtworkData(data);
        expect(normalized.imageUrl).toBe('http://example.com/img.jpg');
        expect(normalized.galleryId).toBe('gallery_123');
        expect(normalized.locationId).toBe('loc_456');
        expect(normalized.heightMeters).toBe(1.5);
    });

    it('should not overwrite existing camelCase fields', () => {
        const store = new XanoEventStore();
        const data = {
            image_url: 'http://snake.com/img.jpg',
            imageUrl: 'http://camel.com/img.jpg'
        };
        const normalized = store._normalizeArtworkData(data);
        expect(normalized.imageUrl).toBe('http://camel.com/img.jpg');
    });

    it('should handle null/undefined data', () => {
        const store = new XanoEventStore();
        expect(store._normalizeArtworkData(null)).toBeNull();
        expect(store._normalizeArtworkData(undefined)).toBe(undefined);
    });
});

describe('XanoEventStore - CSV Parsing', () => {
    it('should parse simple CSV line', () => {
        const store = new XanoEventStore();
        const line = 'a,b,c,d';
        const values = store._parseCSVLine(line);
        expect(values).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should handle quoted fields with commas', () => {
        const store = new XanoEventStore();
        const line = 'a,"b,c",d';
        const values = store._parseCSVLine(line);
        expect(values).toEqual(['a', 'b,c', 'd']);
    });

    it('should handle escaped quotes', () => {
        const store = new XanoEventStore();
        const line = 'a,"b""c",d';
        const values = store._parseCSVLine(line);
        expect(values).toEqual(['a', 'b"c', 'd']);
    });

    it('should parse full CSV text', () => {
        const store = new XanoEventStore();
        const csvText = `id,verb,object_type,object_id,data
1,create,artwork,art_1,"{""title"":""Test""}"
2,update,artwork,art_1,"{""title"":""Updated""}"`;
        const events = store._parseCSV(csvText);
        expect(events).toHaveLength(2);
        expect(events[0].verb).toBe('create');
        expect(events[1].verb).toBe('update');
    });

    it('should handle empty CSV', () => {
        const store = new XanoEventStore();
        expect(store._parseCSV('')).toEqual([]);
        expect(store._parseCSV('header')).toEqual([]);
    });
});

describe('XanoEventStore - Event Deduplication', () => {
    it('should detect existing event', () => {
        const store = new XanoEventStore();
        store.events = [{
            object_id: 'art_123',
            op: 'artwork_upload',
            object_type: 'artwork',
            verb: 'create'
        }];
        store._rebuildIndexes(); // Rebuild indexes after setting events
        expect(store.eventExists('art_123', 'artwork_upload', 'artwork', 'create')).toBe(true);
    });

    it('should return false for non-existing event', () => {
        const store = new XanoEventStore();
        store.events = [{
            object_id: 'art_123',
            op: 'artwork_upload',
            object_type: 'artwork',
            verb: 'create'
        }];
        store._rebuildIndexes(); // Rebuild indexes after setting events
        expect(store.eventExists('art_456', 'artwork_upload', 'artwork', 'create')).toBe(false);
    });

    it('should detect recent duplicate within threshold', () => {
        const store = new XanoEventStore();
        const now = new Date().toISOString();
        store.events = [{
            object_id: 'art_123',
            op: 'artwork_upload',
            object_type: 'artwork',
            verb: 'create',
            created_at: now
        }];
        store._rebuildIndexes(); // Rebuild indexes after setting events
        const eventData = {
            object_id: 'art_123',
            op: 'artwork_upload',
            object_type: 'artwork',
            verb: 'create'
        };
        expect(store._isRecentDuplicate(eventData)).toBe(true);
    });

    it('should not detect old event as recent duplicate', () => {
        const store = new XanoEventStore();
        const oldDate = new Date(Date.now() - 10000).toISOString(); // 10 seconds ago
        store.events = [{
            object_id: 'art_123',
            op: 'artwork_upload',
            object_type: 'artwork',
            verb: 'create',
            created_at: oldDate
        }];
        store._rebuildIndexes(); // Rebuild indexes after setting events
        const eventData = {
            object_id: 'art_123',
            op: 'artwork_upload',
            object_type: 'artwork',
            verb: 'create'
        };
        expect(store._isRecentDuplicate(eventData)).toBe(false);
    });
});

describe('XanoEventStore - State Reconstruction', () => {
    it('should reconstruct state from events in order', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                created_at: '2024-01-01T00:00:00Z',
                data: { title: 'Initial Title', imageUrl: 'http://img.com/1.jpg', locationId: 'main-gallery:back-1', roomId: 'main-gallery', galleryId: 'gallery-1' }
            },
            {
                verb: 'update',
                object_type: 'artwork',
                object_id: 'art_1',
                created_at: '2024-01-02T00:00:00Z',
                data: { title: 'Updated Title' }
            }
        ];
        store.reconstructState();
        expect(store.state.artworks['art_1'].title).toBe('Updated Title');
    });

    it('should handle out-of-order events', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                verb: 'update',
                object_type: 'artwork',
                object_id: 'art_1',
                created_at: '2024-01-02T00:00:00Z',
                data: { title: 'Updated Title' }
            },
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                created_at: '2024-01-01T00:00:00Z',
                data: { title: 'Initial Title', imageUrl: 'http://img.com/1.jpg', locationId: 'main-gallery:back-1', roomId: 'main-gallery', galleryId: 'gallery-1' }
            }
        ];
        store.reconstructState();
        // After sorting and applying, the update should come after create
        expect(store.state.artworks['art_1'].title).toBe('Updated Title');
    });

    it('should handle numeric timestamps', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'catalogue_item',
                object_id: 'cat_1',
                created_at: 1704067200000, // numeric timestamp
                data: { title: 'Item 1', price: 100 }
            }
        ];
        store.reconstructState();
        expect(store.state.catalogue['cat_1'].title).toBe('Item 1');
    });
});

describe('XanoEventStore - Artwork Events', () => {
    it('should create artwork with correct defaults', () => {
        const store = new XanoEventStore();
        store.events = [{
            verb: 'create',
            object_type: 'artwork',
            object_id: 'art_1',
            frame: 'modern',
            scale: '2',
            data: { title: 'Test Art', imageUrl: 'http://img.com/1.jpg' }
        }];
        store.reconstructState();
        const artwork = store.state.artworks['art_1'];
        expect(artwork.placed).toBe(true);
        expect(artwork.frame).toBe('modern');
        expect(artwork.scale).toBe('2');
    });

    it('should mark artwork as unplaced on delete', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                created_at: '2024-01-01T00:00:00Z',
                data: { title: 'Test Art' }
            },
            {
                verb: 'delete',
                object_type: 'artwork',
                object_id: 'art_1',
                created_at: '2024-01-02T00:00:00Z',
                data: {}
            }
        ];
        store.reconstructState();
        expect(store.state.artworks['art_1'].placed).toBe(false);
        expect(store.state.artworks['art_1'].deleted_at).toBeTruthy();
    });

    it('should handle place/unplace events', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                created_at: '2024-01-01T00:00:00Z',
                data: { title: 'Test Art' }
            },
            {
                verb: 'unplace',
                object_type: 'artwork',
                object_id: 'art_1',
                created_at: '2024-01-02T00:00:00Z',
                data: {}
            },
            {
                verb: 'place',
                object_type: 'artwork',
                object_id: 'art_1',
                created_at: '2024-01-03T00:00:00Z',
                data: { location: 'wall-1', locationName: 'Main Wall', roomId: 'main-gallery' }
            }
        ];
        store.reconstructState();
        expect(store.state.artworks['art_1'].placed).toBe(true);
        expect(store.state.artworks['art_1'].location).toBe('wall-1');
    });
});

describe('XanoEventStore - Gallery Events', () => {
    it('should create and update gallery', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'gallery',
                object_id: 'gal_1',
                created_at: '2024-01-01T00:00:00Z',
                data: { name: 'My Gallery' }
            },
            {
                verb: 'update',
                object_type: 'gallery',
                object_id: 'gal_1',
                created_at: '2024-01-02T00:00:00Z',
                data: { name: 'Renamed Gallery', colorTemperature: 5000 }
            }
        ];
        store.reconstructState();
        expect(store.state.galleries['gal_1'].name).toBe('Renamed Gallery');
        expect(store.state.galleries['gal_1'].colorTemperature).toBe(5000);
    });

    it('should soft delete gallery', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'gallery',
                object_id: 'gal_1',
                created_at: '2024-01-01T00:00:00Z',
                data: { name: 'My Gallery' }
            },
            {
                verb: 'delete',
                object_type: 'gallery',
                object_id: 'gal_1',
                created_at: '2024-01-02T00:00:00Z',
                data: {}
            }
        ];
        store.reconstructState();
        expect(store.state.galleries['gal_1']).toBeTruthy();
        expect(store.state.galleries['gal_1'].deleted_at).toBeTruthy();
    });
});

describe('XanoEventStore - Room Events', () => {
    it('should create and update room', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'room',
                object_id: 'room_1',
                data: { name: 'Main Room', wallCount: 4 }
            }
        ];
        store.reconstructState();
        expect(store.state.rooms['room_1'].name).toBe('Main Room');
    });

    it('should delete room completely', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'room',
                object_id: 'room_1',
                created_at: '2024-01-01T00:00:00Z',
                data: { name: 'Main Room' }
            },
            {
                verb: 'delete',
                object_type: 'room',
                object_id: 'room_1',
                created_at: '2024-01-02T00:00:00Z',
                data: {}
            }
        ];
        store.reconstructState();
        expect(store.state.rooms['room_1']).toBe(undefined);
    });
});

describe('XanoEventStore - Catalogue Events', () => {
    it('should create catalogue item', () => {
        const store = new XanoEventStore();
        store.events = [{
            verb: 'create',
            object_type: 'catalogue_item',
            object_id: 'cat_1',
            data: { title: 'Art Print', price: 50, currency: 'USD' }
        }];
        store.reconstructState();
        expect(store.state.catalogue['cat_1'].title).toBe('Art Print');
        expect(store.state.catalogue['cat_1'].price).toBe(50);
    });

    it('should delete catalogue item completely', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'catalogue_item',
                object_id: 'cat_1',
                created_at: '2024-01-01T00:00:00Z',
                data: { title: 'Art Print' }
            },
            {
                verb: 'delete',
                object_type: 'catalogue_item',
                object_id: 'cat_1',
                created_at: '2024-01-02T00:00:00Z',
                data: {}
            }
        ];
        store.reconstructState();
        expect(store.state.catalogue['cat_1']).toBe(undefined);
    });
});

describe('XanoEventStore - Query Methods', () => {
    let store;

    // Setup common test data
    beforeEach = () => {
        store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                data: {
                    title: 'Art 1',
                    imageUrl: 'http://img.com/1.jpg',
                    galleryId: 'gallery-1',
                    roomId: 'main-gallery',
                    locationId: 'main-gallery:back-1'
                }
            },
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_2',
                data: {
                    title: 'Art 2',
                    imageUrl: 'http://img.com/2.jpg',
                    galleryId: 'gallery-1',
                    roomId: 'main-gallery',
                    locationId: 'main-gallery:back-2'
                }
            },
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_3',
                data: {
                    title: 'Art 3',
                    imageUrl: 'http://img.com/3.jpg',
                    galleryId: 'gallery-2',
                    roomId: 'contemporary-wing',
                    locationId: 'contemporary-wing:north-1'
                }
            },
            {
                verb: 'create',
                object_type: 'catalogue_item',
                object_id: 'cat_1',
                data: { title: 'Catalogue 1', price: 100 }
            }
        ];
        store.reconstructState();
    };

    it('should get placed artworks', () => {
        store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                data: { title: 'Art 1', galleryId: 'gallery-1' }
            }
        ];
        store.reconstructState();
        const placed = store.getPlacedArtworks();
        expect(placed).toHaveLength(1);
    });

    it('should filter placed artworks by gallery', () => {
        store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                data: { title: 'Art 1', galleryId: 'gallery-1' }
            },
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_2',
                data: { title: 'Art 2', galleryId: 'gallery-2' }
            }
        ];
        store.reconstructState();
        const gallery1 = store.getPlacedArtworks('gallery-1');
        expect(gallery1).toHaveLength(1);
        expect(gallery1[0].galleryId).toBe('gallery-1');
    });

    it('should get wall artworks', () => {
        store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                data: {
                    title: 'Art 1',
                    imageUrl: 'http://img.com/1.jpg',
                    galleryId: 'gallery-1',
                    roomId: 'main-gallery',
                    locationId: 'main-gallery:back-1'
                }
            }
        ];
        store.reconstructState();
        const wallArt = store.getWallArtworks('gallery-1');
        expect(wallArt).toHaveLength(1);
    });

    it('should get displayable artworks (with imageUrl)', () => {
        store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                data: {
                    title: 'Art 1',
                    imageUrl: 'http://img.com/1.jpg',
                    galleryId: 'gallery-1',
                    roomId: 'main-gallery',
                    locationId: 'main-gallery:back-1'
                }
            },
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_2',
                data: {
                    title: 'Art 2',
                    // no imageUrl
                    galleryId: 'gallery-1',
                    roomId: 'main-gallery',
                    locationId: 'main-gallery:back-2'
                }
            }
        ];
        store.reconstructState();
        const displayable = store.getDisplayableArtworks('gallery-1');
        expect(displayable).toHaveLength(1);
        expect(displayable[0].imageUrl).toBeTruthy();
    });

    it('should get filled space count', () => {
        store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                data: {
                    title: 'Art 1',
                    galleryId: 'gallery-1',
                    locationId: 'loc-1'
                }
            },
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_2',
                data: {
                    title: 'Art 2',
                    galleryId: 'gallery-1',
                    locationId: 'loc-2'
                }
            }
        ];
        store.reconstructState();
        const count = store.getFilledSpaceCount('gallery-1');
        expect(count).toBe(2);
    });

    it('should count same space only once', () => {
        store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                data: {
                    title: 'Art 1',
                    galleryId: 'gallery-1',
                    locationId: 'same-loc'
                }
            },
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_2',
                data: {
                    title: 'Art 2',
                    galleryId: 'gallery-1',
                    locationId: 'same-loc'  // same location
                }
            }
        ];
        store.reconstructState();
        const count = store.getFilledSpaceCount('gallery-1');
        expect(count).toBe(1);
    });

    it('should get artwork by ID', () => {
        store = new XanoEventStore();
        store.events = [{
            verb: 'create',
            object_type: 'artwork',
            object_id: 'art_123',
            data: { title: 'Specific Art' }
        }];
        store.reconstructState();
        const artwork = store.getArtwork('art_123');
        expect(artwork).toBeTruthy();
        expect(artwork.title).toBe('Specific Art');
    });

    it('should return null for non-existent artwork', () => {
        store = new XanoEventStore();
        store.reconstructState();
        expect(store.getArtwork('non_existent')).toBeNull();
    });

    it('should get all catalogue items', () => {
        store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'catalogue_item',
                object_id: 'cat_1',
                data: { title: 'Item 1' }
            },
            {
                verb: 'create',
                object_type: 'catalogue_item',
                object_id: 'cat_2',
                data: { title: 'Item 2' }
            }
        ];
        store.reconstructState();
        const items = store.getCatalogueItems();
        expect(items).toHaveLength(2);
    });

    it('should get catalogue item by ID', () => {
        store = new XanoEventStore();
        store.events = [{
            verb: 'create',
            object_type: 'catalogue_item',
            object_id: 'cat_123',
            data: { title: 'Specific Item', price: 99 }
        }];
        store.reconstructState();
        const item = store.getCatalogueItem('cat_123');
        expect(item).toBeTruthy();
        expect(item.price).toBe(99);
    });
});

describe('XanoEventStore - Duplicate Detection', () => {
    it('should find duplicate create events', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                id: 1,
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                op: 'artwork_upload',
                created_at: '2024-01-01T00:00:00Z'
            },
            {
                id: 2,
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                op: 'artwork_upload',
                created_at: '2024-01-02T00:00:00Z'
            }
        ];
        const duplicates = store.findDuplicateEvents();
        expect(duplicates).toHaveLength(1);
        expect(duplicates[0].id).toBe(2); // newer one is duplicate
    });

    it('should not flag update events as duplicates', () => {
        const store = new XanoEventStore();
        store.events = [
            {
                verb: 'create',
                object_type: 'artwork',
                object_id: 'art_1',
                op: 'artwork_upload',
                created_at: '2024-01-01T00:00:00Z'
            },
            {
                verb: 'update',
                object_type: 'artwork',
                object_id: 'art_1',
                op: 'artwork_upload',
                created_at: '2024-01-02T00:00:00Z'
            }
        ];
        const duplicates = store.findDuplicateEvents();
        expect(duplicates).toHaveLength(0);
    });
});

describe('XanoEventStore - Performance', () => {
    it('should handle large event sets efficiently', () => {
        const store = new XanoEventStore();
        const numEvents = 1000;

        // Generate many events
        for (let i = 0; i < numEvents; i++) {
            store.events.push({
                verb: 'create',
                object_type: 'artwork',
                object_id: `art_${i}`,
                created_at: new Date(Date.now() - (numEvents - i) * 1000).toISOString(),
                data: { title: `Art ${i}`, imageUrl: `http://img.com/${i}.jpg`, galleryId: 'gallery-1' }
            });
        }

        const startTime = Date.now();
        store.reconstructState();
        const reconstructTime = Date.now() - startTime;

        expect(Object.keys(store.state.artworks)).toHaveLength(numEvents);
        expect(reconstructTime).toBeLessThan(1000); // Should complete within 1 second
        console.log(`     (Reconstructed ${numEvents} events in ${reconstructTime}ms)`);
    });

    it('should handle query operations efficiently', () => {
        const store = new XanoEventStore();

        // Setup 500 artworks across 5 galleries
        for (let i = 0; i < 500; i++) {
            store.events.push({
                verb: 'create',
                object_type: 'artwork',
                object_id: `art_${i}`,
                data: {
                    title: `Art ${i}`,
                    imageUrl: `http://img.com/${i}.jpg`,
                    galleryId: `gallery-${i % 5}`,
                    roomId: 'main-gallery',
                    locationId: `main-gallery:back-${(i % 3) + 1}`
                }
            });
        }
        store.reconstructState();

        const startTime = Date.now();

        // Run multiple queries
        for (let i = 0; i < 100; i++) {
            store.getPlacedArtworks('gallery-0');
            store.getWallArtworks('gallery-1');
            store.getDisplayableArtworks('gallery-2');
            store.getFilledSpaceCount('gallery-3');
        }

        const queryTime = Date.now() - startTime;
        expect(queryTime).toBeLessThan(500); // 100 iterations should be fast
        console.log(`     (400 queries completed in ${queryTime}ms)`);
    });
});

describe('XanoEventStore - Optimization Features', () => {
    it('should use O(1) index for eventExists', () => {
        const store = new XanoEventStore();
        // Add 1000 events
        for (let i = 0; i < 1000; i++) {
            store.events.push({
                object_id: `art_${i}`,
                op: 'artwork_upload',
                object_type: 'artwork',
                verb: 'create'
            });
        }
        store._rebuildIndexes();

        const startTime = Date.now();
        // Check 1000 times
        for (let i = 0; i < 1000; i++) {
            store.eventExists(`art_${i}`, 'artwork_upload', 'artwork', 'create');
        }
        const elapsed = Date.now() - startTime;

        expect(elapsed).toBeLessThan(50); // Should be very fast with O(1) lookups
        console.log(`     (1000 eventExists calls in ${elapsed}ms)`);
    });

    it('should cache query results', () => {
        const store = new XanoEventStore();
        store.events = [{
            verb: 'create',
            object_type: 'artwork',
            object_id: 'art_1',
            data: { title: 'Art 1', galleryId: 'gallery-1' }
        }];
        store.reconstructState();

        // First call - computes result
        const result1 = store.getPlacedArtworks('gallery-1');

        // Second call - should return cached result
        const result2 = store.getPlacedArtworks('gallery-1');

        expect(result1).toEqual(result2);
        expect(store._queryCache.size).toBeGreaterThan(0);
    });

    it('should invalidate cache on state change', () => {
        const store = new XanoEventStore();
        store.events = [{
            verb: 'create',
            object_type: 'artwork',
            object_id: 'art_1',
            data: { title: 'Art 1', galleryId: 'gallery-1' }
        }];
        store.reconstructState();

        const cacheVersion1 = store._queryCacheVersion;
        store.getPlacedArtworks('gallery-1'); // Populate cache

        // Reconstruct state should invalidate cache
        store.reconstructState();

        const cacheVersion2 = store._queryCacheVersion;
        expect(cacheVersion2).toBeGreaterThan(cacheVersion1);
        expect(store._queryCache.size).toBe(0);
    });

    it('should index events by object_id', () => {
        const store = new XanoEventStore();
        store.events = [
            { object_id: 'art_1', op: 'upload', object_type: 'artwork', verb: 'create' },
            { object_id: 'art_1', op: 'edit', object_type: 'artwork', verb: 'update' },
            { object_id: 'art_2', op: 'upload', object_type: 'artwork', verb: 'create' }
        ];
        store._rebuildIndexes();

        expect(store._eventsByObjectId.get('art_1')).toHaveLength(2);
        expect(store._eventsByObjectId.get('art_2')).toHaveLength(1);
    });
});

describe('Helper Functions', () => {
    it('should generate unique event UIDs', () => {
        const uid1 = generateEventUID();
        const uid2 = generateEventUID();
        expect(uid1).toContain('evt_');
        expect(uid2).toContain('evt_');
        expect(uid1).not.toBe(uid2);
    });

    it('should generate unique object IDs with prefix', () => {
        const id1 = generateObjectId('art');
        const id2 = generateObjectId('cat');
        expect(id1).toContain('art_');
        expect(id2).toContain('cat_');
    });
});

// ============================================
// RUN TESTS AND REPORT
// ============================================

console.log('\n' + '=' .repeat(50));
console.log('📊 Test Results Summary');
console.log('=' .repeat(50));
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);
console.log(`📈 Total:  ${testsPassed + testsFailed}`);
console.log(`🎯 Pass Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);

if (testsFailed > 0) {
    console.log('\n❌ Failed Tests:');
    testResults.filter(r => !r.passed).forEach(r => {
        console.log(`   - ${r.description}: ${r.error}`);
    });
    process.exit(1);
} else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
}
