import { BuddyBridgeAPI, type StreamChunk } from '../src/api';

describe('BuddyBridgeAPI', () => {
    let api: BuddyBridgeAPI;
    beforeEach(() => { api = new BuddyBridgeAPI(); });

    it('should create instance', () => { expect(api).toBeDefined(); });
    it('should accept custom timeout', () => { const a = new BuddyBridgeAPI(5000); expect(a).toBeDefined(); });
    it('should generate valid UUID', () => { expect(api.generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); });

    describe('setCodebuddyPath', () => {
        it('should not throw', () => { api.setCodebuddyPath(''); });
    });

    describe('cancel', () => {
        it('should not throw', () => { api.cancel(); });
    });
});
