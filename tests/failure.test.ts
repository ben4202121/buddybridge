import { isGatewayEmptyStream } from '../src/chat/failure';

describe('isGatewayEmptyStream', () => {
    it('detects the actual Empty stream gateway failure text', () => {
        const msg = 'Empty stream: upstream gateway sent only placeholder chunks without any model output (chunks=1, bytes=734)';
        expect(isGatewayEmptyStream(msg)).toBe(true);
    });

    it('detects with leading whitespace and linebreak variants', () => {
        expect(isGatewayEmptyStream('  Empty stream\nupstream gateway sent only placeholder chunks')).toBe(true);
    });

    it('detects alternative placeholder phrasing', () => {
        expect(isGatewayEmptyStream('placeholder chunks received from gateway')).toBe(true);
        expect(isGatewayEmptyStream('upstream gateway sent only placeholder chunks')).toBe(true);
    });

    it('rejects when thinking or tool parts exist (real model output)', () => {
        expect(isGatewayEmptyStream('Empty stream: upstream gateway...', 5, 0)).toBe(false);
        expect(isGatewayEmptyStream('Empty stream: upstream gateway...', 0, 1)).toBe(false);
    });

    it('rejects empty / whitespace-only replies', () => {
        expect(isGatewayEmptyStream('')).toBe(false);
        expect(isGatewayEmptyStream('   ')).toBe(false);
    });

    it('rejects a normal reply that merely mentions the phrase mid-sentence', () => {
        expect(isGatewayEmptyStream('I fixed the empty stream issue in your code.')).toBe(false);
        expect(isGatewayEmptyStream('说明：upstream gateway 只在超时时回占位 chunk，请稍后重试。')).toBe(false);
    });
});
