/**
 * 上游网关失败判定：CodeBuddy 网关只回占位 chunk 时（Empty stream / placeholder chunks），
 * 整条回复不是模型输出而是网关报错（如 Tencent Copilot 上下文膨胀后只回占位）。
 * 仅当没有任何思考/工具卡、且正文以该失败签名开头时命中，避免误判正常回复正文。
 */
export function isGatewayEmptyStream(text: string, thinkingLen = 0, partsLen = 0): boolean {
    if (thinkingLen > 0 || partsLen > 0) return false;
    const t = text.trim();
    if (!t) return false;
    return /^empty\s*stream\b|^placeholder\s*chunks\b|upstream\s*gateway\s*sent\s*only/i.test(t);
}
