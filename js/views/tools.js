// flash_tool/static/js/tools.js
// 版本/工具模块

/**
 * 加载当前工具版本号（WebUSB 模式：从 changelog 读取版本，不依赖后端）。
 */
async function loadVersion() {
    const verEl = document.getElementById('versionToolVersion');
    if (!verEl) return;
    try {
        // WebUSB 模式：从 CHANGELOG_TEXT 解析最新版本号
        let version = '';
        if (typeof CHANGELOG_TEXT !== 'undefined') {
            const m = CHANGELOG_TEXT.match(/^v(\d+\.\d+\.\d+)/);
            if (m) version = m[1];
        }
        verEl.textContent = version ? ('v' + version) : 'v4.0.20';
        if (typeof renderVersionChangelog === 'function') {
            renderVersionChangelog('versionChangelog', version || '4.0.20');
        }
        if (App && typeof App.set === 'function') {
            App.set('toolVersion', version || '4.0.20');
        }
    } catch(e) {
        verEl.textContent = 'v4.0.20';
    }
}

/**
 * 检查更新（WebUSB 模式：不支持在线更新检查）。
 */
async function checkUpdate(silent) {
    const tip = document.getElementById('versionUpdateTip');
    const btn = document.getElementById('versionUpdateBtn');
    if (!silent) {
        if (tip) tip.textContent = 'WebUSB 模式不支持在线更新检查';
        if (btn) btn.disabled = false;
    }
}

/**
 * 执行更新（WebUSB 模式：不支持）。
 */
async function doUpdate() {
    const tip = document.getElementById('versionUpdateTip');
    if (tip) tip.textContent = 'WebUSB 模式不支持在线更新，请手动更新项目文件';
}

// ============ VBmeta（文件管理器选择镜像 + 参数位置可选） ============

function getVbmetaImagePath() {
    const input = document.getElementById('vbmetaImagePath');
    return input ? input.value.trim() : '';
}

function updateVbmetaBtnState() {
    const btn = document.getElementById('disableVbmetaBtn');
    if (!btn) return;
    btn.disabled = !getVbmetaImagePath();
}

async function pickVbmetaImage() {
    return new Promise(function(resolve) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.img';
        input.onchange = function() {
            if (!input.files || !input.files.length) { resolve(); return; }
            var file = input.files[0];
            var pathInput = document.getElementById('vbmetaImagePath');
            var display = document.getElementById('vbmetaPathDisplay');
            if (pathInput) pathInput.value = file.name;
            if (display) display.textContent = '📄 ' + file.name;
            // 保存 File 对象供刷写使用
            if (pathInput) pathInput._fileObj = file;
            updateVbmetaBtnState();
            resolve();
        };
        input.click();
    });
}

async function disableVbmeta() {
    const img = getVbmetaImagePath();
    if (!img) return;

    const paramPos = document.getElementById('vbmetaParamPos');
    const pos = paramPos ? paramPos.value : 'after';
    const disableFlags = '--disable-verity --disable-verification';

    const extraAfter = pos === 'after' ? disableFlags : '';
    const extraBefore = pos === 'before' ? disableFlags : '';

    const cmdDesc = pos === 'before'
        ? `fastboot ${disableFlags} flash vbmeta 镜像`
        : `fastboot flash vbmeta 镜像 ${disableFlags}`;

    showConfirm('操作确认', '刷入 vbmeta 并关闭校验（' + cmdDesc + '），确认继续？', async () => {
        setModuleStatus('toolbox', '工具箱状态：准备刷入 vbmeta 并关闭校验。', 'warn');
        showModuleProgress('toolbox', '准备刷入 vbmeta');
        // WebUSB 模式（唯一路径）
        if (!webusbFastbootReady || !webusbFastboot) {
            setModuleStatus('toolbox', 'Fastboot设备未连接，请先在顶部胶囊点击设备检测连接。', 'err');
            return;
        }
        try {
            writeLog('WebUSB模式：刷入 vbmeta 并关闭校验。', 'tip');
            var pathInput = document.getElementById('vbmetaImagePath');
            var fileObj = (pathInput && pathInput._fileObj) ? pathInput._fileObj : null;
            if (!fileObj) {
                setModuleStatus('toolbox', 'WebUSB vbmeta刷写失败：镜像文件不可用，请重新选择。', 'err');
                return;
            }
            await webusbFastboot.flash('vbmeta', fileObj, p => updateModuleProgress('toolbox', p, 'WebUSB刷写 vbmeta'));
            updateModuleProgress('toolbox', 100, 'vbmeta 已刷入');
            setModuleStatus('toolbox', 'WebUSB已刷入 vbmeta，校验关闭完成。', 'ok');
            showToast('WebUSB vbmeta 关闭校验完成');
        } catch(e) {
            hideModuleProgress('toolbox');
            setModuleStatus('toolbox', 'WebUSB vbmeta刷写失败：' + e.message, 'err');
        }
    }, false);
}

// ============ 版本/工具模块事件委托 ============
function handleVersionAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'check-update') {
        e.preventDefault();
        checkUpdate(false);
    } else if (action === 'do-update') {
        e.preventDefault();
        doUpdate();
    }
}

// ============ 模块初始化 ============
Modules.register('tools', ['api','utils','device-info'], function initToolsModule() {
    // VBmeta 文件选择按钮
    const vbmetaPickBtn = document.getElementById('vbmetaPickBtn');
    if (vbmetaPickBtn) vbmetaPickBtn.onclick = pickVbmetaImage;

    // VBmeta 执行关闭校验
    const disableVbmetaBtn = document.getElementById('disableVbmetaBtn');
    if (disableVbmetaBtn) disableVbmetaBtn.onclick = disableVbmeta;

    loadVersion();

    console.log('[tools] 版本/工具模块已初始化');
    return true;
});