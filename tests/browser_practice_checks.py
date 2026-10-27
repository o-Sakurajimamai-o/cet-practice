"""Exercise the new practice features through a real browser and local server."""
import re


def check_practice_features(page, check):
    check('listening passages are grouped', page.locator('.listening-divider').count() > 0)
    check('question navigation is present', page.locator('.qnav-card .qnav button').count() > 0)
    option = page.locator('.qcard [role="button"][aria-pressed] .otext').first
    option.scroll_into_view_if_needed()
    selected_text = option.evaluate('''el => {
        const node = el.firstChild;
        const range = document.createRange();
        range.setStart(node, 0); range.setEnd(node, Math.min(5, node.length));
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return selection.toString();
    }''')
    page.locator('.mark-popup').click()
    page.get_by_text('已标记 1').wait_for()
    check('selected option text can be marked', bool(selected_text))
    check('marking does not answer the question', option.locator('xpath=..').get_attribute('aria-pressed') == 'false')
    page.reload()
    page.wait_for_selector('.qcard')
    page.get_by_text('已标记 1').wait_for()
    check('word mark survives reload', True)
    if page.evaluate("() => !!(CSS.highlights && window.Highlight)"):
        page.wait_for_function("() => CSS.highlights.get('practice-marks')?.size > 0")
        check('browser renders saved text highlight', True)
    else:
        check('unsupported browser shows mark-list fallback', page.get_by_text('当前浏览器不支持文章内高亮').is_visible())
    page.locator('.section-side-switch .next').click()
    page.locator('.word-options').first.wait_for()
    check('side switch and cloze word bank', page.locator('.word-options [data-mark-index]').count() >= 4)
    page.get_by_role('tab', name=re.compile('仔细阅读一')).click()
    page.locator('.reading-paragraph').first.wait_for()
    check('reading passage has paragraph breaks', page.locator('.reading-paragraph').count() > 1)
