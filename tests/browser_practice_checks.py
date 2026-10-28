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

    # Submit a disposable session and verify paragraph-by-paragraph translations.
    page.get_by_role('button', name='交卷', exact=True).click()
    page.get_by_role('button', name='确认交卷', exact=True).click()
    page.get_by_role('button', name='切换为中英对照').wait_for()
    check('translation hidden by default', page.locator('.reading-paragraph-cn').count() == 0)
    page.get_by_role('button', name='切换为中英对照').click()
    pairs = page.locator('.reading-paragraph-pair')
    check('bilingual paragraphs aligned', pairs.count() > 1 and page.locator('.reading-paragraph-cn').count() == pairs.count())
    page.get_by_role('button', name='切换为仅原文').click()
    check('translation toggles back to original', page.locator('.reading-paragraph-cn').count() == 0)
    page.goto(page.url.split('/#/')[0] + '/#/review')
    page.get_by_role('tab', name=re.compile('我的标记')).click()
    page.locator('.mark-stats').wait_for()
    check('marked word statistics visible', page.get_by_text('标记概览').is_visible() and page.locator('.mark-card').count() >= 1)
    check('marked word export available', page.get_by_role('button', name='下载 CSV').is_enabled())
