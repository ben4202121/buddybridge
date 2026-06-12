/**
 * 可折叠交互辅助。参照 Claudian 的 ThinkingBlockRenderer。
 * 使用原生 classList，避免 Obsidian addClass/removeClass 在 addEventListener 回调中行为不一致。
 */

export function setupCollapsible(
    wrapperEl: HTMLElement,
    headerEl: HTMLElement,
    contentEl: HTMLElement
): void {
    headerEl.setAttribute('tabindex', '0');
    headerEl.setAttribute('role', 'button');
    headerEl.setAttribute('aria-expanded', 'false');

    const toggle = (e: Event) => {
        e.stopPropagation();
        const expanded = wrapperEl.classList.contains('expanded');
        if (expanded) {
            wrapperEl.classList.remove('expanded');
            contentEl.classList.add('buddybridge-hidden');
            headerEl.setAttribute('aria-expanded', 'false');
        } else {
            wrapperEl.classList.add('expanded');
            contentEl.classList.remove('buddybridge-hidden');
            headerEl.setAttribute('aria-expanded', 'true');
        }
    };

    headerEl.addEventListener('click', toggle);
    headerEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            toggle(e);
        }
    });
}
