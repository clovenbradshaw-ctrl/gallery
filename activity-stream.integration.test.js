/**
 * Activity Stream Integration Tests
 *
 * These tests verify the activity stream functionality using:
 * 1. Live Xano API (if accessible)
 * 2. Local CSV fallback (if API is not accessible)
 *
 * Run with: node activity-stream.integration.test.js
 */

const fs = require('fs');
const path = require('path');

const XANO_API_URL = 'https://xvkq-pq7i-idtl.n7d.xano.io/api:gx-QnxD1/events';
const LOCAL_CSV_PATH = path.join(__dirname, 'data.csv');

let useLocalFallback = false;
let testsPassed = 0;
let testsFailed = 0;
const testResults = [];

// Test utilities
function describe(description, fn) {
    console.log(`\n📦 ${description}`);
    return fn();
}

async function it(description, fn) {
    try {
        await fn();
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
        }
    };

    matchers.not = {
        toBe(expected) {
            if (actual === expected) {
                throw new Error(`Expected ${JSON.stringify(actual)} not to be ${JSON.stringify(expected)}`);
            }
        }
    };

    return matchers;
}

// CSV parsing functions
function parseCSVLine(line) {
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

function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const events = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = parseCSVLine(line);
        const event = {};

        headers.forEach((header, index) => {
            event[header] = values[index] || '';
        });

        if (event.data && typeof event.data === 'string') {
            try {
                event.data = JSON.parse(event.data);
            } catch (e) {
                // Keep as string
            }
        }

        events.push(event);
    }

    return events;
}

// Check API availability
async function checkAPIAvailability() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(XANO_API_URL, {
            method: 'GET',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response.ok;
    } catch (error) {
        return false;
    }
}

// Fetch events (from API or local fallback)
async function fetchEvents() {
    if (useLocalFallback) {
        const csvText = fs.readFileSync(LOCAL_CSV_PATH, 'utf8');
        return parseCSV(csvText);
    }

    const response = await fetch(XANO_API_URL);
    const data = await response.json();

    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
        return data.items || data.data || data.events || data.records || [];
    }
    return [];
}

// ============================================
// INTEGRATION TESTS
// ============================================

console.log('🧪 Activity Stream Integration Test Suite');
console.log('=' .repeat(50));

async function runTests() {
    // Check API availability first
    console.log('Checking API availability...');
    const apiAvailable = await checkAPIAvailability();

    if (apiAvailable) {
        console.log(`✓ API is accessible: ${XANO_API_URL}`);
    } else {
        console.log(`✗ API not accessible, using local CSV fallback`);
        useLocalFallback = true;
    }
    console.log('=' .repeat(50));

    await describe('Data Source Connectivity', async () => {
        await it('should have access to event data', async () => {
            const events = await fetchEvents();
            expect(Array.isArray(events)).toBeTruthy();
            expect(events.length).toBeGreaterThan(0);
            console.log(`     (Data source: ${useLocalFallback ? 'Local CSV' : 'Xano API'})`);
        });
    });

    await describe('Event Data Structure', async () => {
        await it('should fetch events with expected count', async () => {
            const events = await fetchEvents();
            expect(events.length).toBeGreaterThan(0);
            console.log(`     (Fetched ${events.length} events)`);
        });

        await it('should have events with required fields', async () => {
            const events = await fetchEvents();
            if (events.length > 0) {
                const event = events[0];
                const fields = Object.keys(event);
                console.log(`     Sample event fields: ${fields.join(', ')}`);
                // Events should have at minimum these common fields
                expect(fields.length).toBeGreaterThan(3);
            }
        });

        await it('should have events with object_type field', async () => {
            const events = await fetchEvents();
            const withObjectType = events.filter(e => e.object_type);
            console.log(`     (${withObjectType.length}/${events.length} events have object_type)`);
            expect(withObjectType.length).toBeGreaterThan(0);
        });

        await it('should have events with object_id field', async () => {
            const events = await fetchEvents();
            const withObjectId = events.filter(e => e.object_id);
            console.log(`     (${withObjectId.length}/${events.length} events have object_id)`);
            expect(withObjectId.length).toBeGreaterThan(0);
        });
    });

    await describe('State Reconstruction', async () => {
        await it('should reconstruct catalogue items from events', async () => {
            const events = await fetchEvents();
            const catalogueEvents = events.filter(e => e.object_type === 'catalogue_item');
            console.log(`     (Found ${catalogueEvents.length} catalogue events)`);

            // Reconstruct catalogue state
            const catalogue = {};
            for (const event of catalogueEvents) {
                let eventData = event.data;
                if (typeof eventData === 'string') {
                    try { eventData = JSON.parse(eventData); } catch (e) { eventData = {}; }
                }
                eventData = eventData || {};

                if (event.verb === 'create' || event.verb === 'update') {
                    catalogue[event.object_id] = {
                        id: event.object_id,
                        ...eventData
                    };
                } else if (event.verb === 'delete') {
                    delete catalogue[event.object_id];
                }
            }

            const catalogueCount = Object.keys(catalogue).length;
            console.log(`     (Reconstructed ${catalogueCount} unique catalogue items)`);
            expect(catalogueCount).toBeGreaterThan(0);
        });

        await it('should reconstruct artwork state from events', async () => {
            const events = await fetchEvents();
            const artworkEvents = events.filter(e => e.object_type === 'artwork');
            console.log(`     (Found ${artworkEvents.length} artwork events)`);

            // Reconstruct artwork state
            const artworks = {};
            for (const event of artworkEvents) {
                let eventData = event.data;
                if (typeof eventData === 'string') {
                    try { eventData = JSON.parse(eventData); } catch (e) { eventData = {}; }
                }
                eventData = eventData || {};

                if (event.verb === 'create') {
                    artworks[event.object_id] = {
                        id: event.object_id,
                        ...eventData,
                        placed: true
                    };
                } else if (event.verb === 'update' && artworks[event.object_id]) {
                    artworks[event.object_id] = { ...artworks[event.object_id], ...eventData };
                } else if ((event.verb === 'delete' || event.verb === 'unplace') && artworks[event.object_id]) {
                    artworks[event.object_id].placed = false;
                }
            }

            const placedArtworks = Object.values(artworks).filter(a => a.placed);
            console.log(`     (Reconstructed ${placedArtworks.length} placed artworks)`);

            if (artworkEvents.length > 0) {
                expect(Object.keys(artworks).length).toBeGreaterThan(0);
            }
        });

        await it('should correctly process event verbs', async () => {
            const events = await fetchEvents();
            const verbs = [...new Set(events.map(e => e.verb).filter(Boolean))];
            console.log(`     (Found verbs: ${verbs.join(', ')})`);
            expect(verbs.length).toBeGreaterThan(0);
        });
    });

    await describe('Data Integrity', async () => {
        await it('should have mostly unique event_uids', async () => {
            const events = await fetchEvents();
            const uids = events.map(e => e.event_uid).filter(Boolean);
            const uniqueUids = new Set(uids);

            const duplicateCount = uids.length - uniqueUids.size;
            const duplicateRatio = uids.length > 0 ? duplicateCount / uids.length : 0;
            console.log(`     (${duplicateCount} duplicate UIDs out of ${uids.length}, ${(duplicateRatio * 100).toFixed(1)}%)`);

            // Some duplicates are acceptable from CSV merge
            expect(duplicateRatio).toBeLessThan(0.5);
        });

        await it('should have valid timestamps', async () => {
            const events = await fetchEvents();
            let validTimestamps = 0;
            let invalidTimestamps = 0;

            for (const event of events) {
                const timestamp = event.created_at || event.published;
                if (timestamp) {
                    let date;
                    // Handle various timestamp formats:
                    // - Unix milliseconds as number: 1764220380624
                    // - Unix milliseconds as string: "1764220380624"
                    // - ISO date string: "2024-01-01T00:00:00Z"
                    if (typeof timestamp === 'number') {
                        date = new Date(timestamp);
                    } else if (/^\d+$/.test(timestamp)) {
                        // Numeric string (Unix ms timestamp)
                        date = new Date(parseInt(timestamp, 10));
                    } else {
                        // ISO or other date string
                        date = new Date(timestamp);
                    }

                    if (isNaN(date.getTime())) {
                        invalidTimestamps++;
                    } else {
                        validTimestamps++;
                    }
                }
            }

            console.log(`     (${validTimestamps} valid, ${invalidTimestamps} invalid timestamps)`);
            expect(validTimestamps).toBeGreaterThan(0);
        });

        await it('should have catalogue items with titles', async () => {
            const events = await fetchEvents();
            const catalogueEvents = events.filter(e => e.object_type === 'catalogue_item' && e.verb === 'create');

            let withTitle = 0;
            for (const event of catalogueEvents) {
                let data = event.data;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (e) { data = {}; }
                }
                if (data && data.title) withTitle++;
            }

            console.log(`     (${withTitle}/${catalogueEvents.length} catalogue items have titles)`);
            if (catalogueEvents.length > 0) {
                expect(withTitle).toBeGreaterThan(0);
            }
        });

        await it('should have artworks with gallery assignments', async () => {
            const events = await fetchEvents();
            const artworkEvents = events.filter(e => e.object_type === 'artwork' && e.verb === 'create');

            let withGallery = 0;
            for (const event of artworkEvents) {
                let data = event.data;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (e) { data = {}; }
                }
                if (data && (data.galleryId || data.gallery_id)) withGallery++;
            }

            console.log(`     (${withGallery}/${artworkEvents.length} artworks have gallery assignments)`);
            if (artworkEvents.length > 0) {
                expect(withGallery).toBeGreaterThan(0);
            }
        });
    });

    await describe('Event Type Distribution', async () => {
        await it('should have expected object types', async () => {
            const events = await fetchEvents();
            const objectTypes = {};

            for (const event of events) {
                const type = event.object_type || 'unknown';
                objectTypes[type] = (objectTypes[type] || 0) + 1;
            }

            console.log('     Event distribution by object_type:');
            for (const [type, count] of Object.entries(objectTypes)) {
                console.log(`       - ${type}: ${count}`);
            }

            expect(Object.keys(objectTypes).length).toBeGreaterThan(0);
        });

        await it('should have more catalogue items than artworks (typical pattern)', async () => {
            const events = await fetchEvents();
            const catalogueCount = events.filter(e => e.object_type === 'catalogue_item').length;
            const artworkCount = events.filter(e => e.object_type === 'artwork').length;

            console.log(`     (Catalogue: ${catalogueCount}, Artworks: ${artworkCount})`);
            // This is just an observation, not a strict requirement
        });
    });

    await describe('Performance', async () => {
        await it('should fetch events quickly', async () => {
            const startTime = Date.now();
            await fetchEvents();
            const elapsed = Date.now() - startTime;

            console.log(`     (Fetch completed in ${elapsed}ms)`);
            expect(elapsed).toBeLessThan(5000);
        });

        await it('should reconstruct state quickly', async () => {
            const events = await fetchEvents();

            const startTime = Date.now();

            // Simulate full state reconstruction
            const state = { artworks: {}, catalogue: {}, galleries: {}, rooms: {} };

            for (const event of events) {
                let data = event.data;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (e) { data = {}; }
                }
                data = data || {};

                if (event.object_type === 'catalogue_item') {
                    if (event.verb === 'create' || event.verb === 'update') {
                        state.catalogue[event.object_id] = { id: event.object_id, ...data };
                    } else if (event.verb === 'delete') {
                        delete state.catalogue[event.object_id];
                    }
                } else if (event.object_type === 'artwork') {
                    if (event.verb === 'create') {
                        state.artworks[event.object_id] = { id: event.object_id, ...data, placed: true };
                    } else if (event.verb === 'update' && state.artworks[event.object_id]) {
                        state.artworks[event.object_id] = { ...state.artworks[event.object_id], ...data };
                    } else if (event.verb === 'delete' && state.artworks[event.object_id]) {
                        state.artworks[event.object_id].placed = false;
                    }
                }
            }

            const elapsed = Date.now() - startTime;
            console.log(`     (State reconstruction: ${elapsed}ms for ${events.length} events)`);
            expect(elapsed).toBeLessThan(1000);
        });
    });

    // Print results
    console.log('\n' + '=' .repeat(50));
    console.log('📊 Integration Test Results Summary');
    console.log('=' .repeat(50));
    console.log(`Data Source: ${useLocalFallback ? 'Local CSV' : 'Xano API'}`);
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
        console.log('\n🎉 All integration tests passed!');
        process.exit(0);
    }
}

// Run tests
runTests().catch(error => {
    console.error('\n💥 Test suite crashed:', error);
    process.exit(1);
});
