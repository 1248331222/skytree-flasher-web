// flash_tool/static/js/views/workbench.js
// ============ 工作台 v4.0.0（重构版） ============
// 配置栏 + 步骤列表（拖拽排序+单独执行）+ 添加步骤弹窗 + Fastboot快捷命令弹窗 + 执行栏

// ===== WebUSB 配置存储（手机 123456/workbench 目录，通过 File System Access API）=====
var _wbWebusbDirHandle = null;  // workbench 目录的 FileSystemDirectoryHandle

/**
 * 请求用户授权手机目录访问权限（showDirectoryPicker）
 * 用户选择根目录后，自动导航到 123456/workbench
 */
async function _wbRequestDirAccess() {
    if (!window.showDirectoryPicker) {
        _wbSetStatus('工作台状态：当前浏览器不支持目录访问 API，请使用 Chrome/Edge', 'err');
        return null;
    }
    try {
        _wbSetStatus('工作台状态：请在弹窗中选择手机存储根目录...', 'info');
        var rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        // 存储到 file-api.js 的 IndexedDB
        if (typeof FileApi !== 'undefined' && FileApi._storeRootHandle) {
            await FileApi._storeRootHandle(rootHandle);
        } else if (window._webusbRootDirHandle !== undefined) {
            window._webusbRootDirHandle = rootHandle;
        }
        // 导航到 123456/workbench
        var dir123456 = await rootHandle.getDirectoryHandle('123456', { create: true });
        _wbWebusbDirHandle = await dir123456.getDirectoryHandle('workbench', { create: true });
        _wbSetStatus('工作台状态：已获取目录访问权限 (' + rootHandle.name + '/123456/workbench)', 'ok');
        // 更新全局目录按钮状态
        if (typeof window._updateDirBtnState === 'function') window._updateDirBtnState();
        return _wbWebusbDirHandle;
    } catch(e) {
        if (e.name === 'AbortError') {
            _wbSetStatus('工作台状态：用户取消了目录选择', 'warn');
        } else {
            _wbSetStatus('工作台状态：获取目录权限失败 - ' + e.message, 'err');
        }
        return null;
    }
}

async function _wbGetWebusbDir() {
    if (_wbWebusbDirHandle) {
        // 验证权限是否仍然有效（优先 readwrite，其次 read）
        try {
            var permRW = await _wbWebusbDirHandle.queryPermission({ mode: 'readwrite' });
            if (permRW === 'granted') return _wbWebusbDirHandle;
            var permR = await _wbWebusbDirHandle.queryPermission({ mode: 'read' });
            if (permR === 'granted') return _wbWebusbDirHandle;
            // 尝试请求 read 权限
            var reqPerm = await _wbWebusbDirHandle.requestPermission({ mode: 'read' });
            if (reqPerm === 'granted') return _wbWebusbDirHandle;
        } catch(e) { /* fall through */ }
        _wbWebusbDirHandle = null;
    }
    if (!window.showDirectoryPicker) return null;
    // 尝试从 file-api.js 恢复已存储的根目录 handle
    if (typeof FileApi !== 'undefined' && FileApi.restoreWebusbRootHandle) {
        var rootHandle = await FileApi.restoreWebusbRootHandle();
        if (rootHandle) {
            try {
                var dir123456 = await rootHandle.getDirectoryHandle('123456', { create: false });
                _wbWebusbDirHandle = await dir123456.getDirectoryHandle('workbench', { create: false });
                return _wbWebusbDirHandle;
            } catch(e) {
                // 目录可能不存在或有 read-only 权限，尝试创建
                try {
                    var dir123456b = await rootHandle.getDirectoryHandle('123456', { create: true });
                    _wbWebusbDirHandle = await dir123456b.getDirectoryHandle('workbench', { create: true });
                    return _wbWebusbDirHandle;
                } catch(e2) {
                    console.error('[workbench] 获取 workbench 目录失败:', e2);
                }
            }
        }
    }
    // 无法恢复：返回 null，调用方应调用 _wbRequestDirAccess() 请求权限
    return null;
}

async function _wbWebusbListConfigs() {
    var dir = await _wbGetWebusbDir();
    if (!dir) return [];
    var configs = [];
    try {
        for await (var entry of dir.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                var name = entry.name.replace(/\.json$/, '');
                try {
                    var file = await entry.getFile();
                    var content = JSON.parse(await file.text());
                    var stepCount = (content.steps || []).length;
                    configs.push({ name: name, step_count: stepCount });
                } catch(e) { /* skip invalid */ }
            }
        }
    } catch(e) { /* ignore */ }
    return configs;
}

async function _wbWebusbLoadConfig(name) {
    var dir = await _wbGetWebusbDir();
    if (!dir) return null;
    try {
        var fileHandle = await dir.getFileHandle(name + '.json');
        var file = await fileHandle.getFile();
        var content = JSON.parse(await file.text());
        return { steps: content.steps || [] };
    } catch(e) { return null; }
}

async function _wbWebusbSaveConfig(name, steps) {
    var dir = await _wbGetWebusbDir();
    if (!dir) return false;
    try {
        var fileHandle = await dir.getFileHandle(name + '.json', { create: true });
        var writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify({ name: name, steps: steps }, null, 2));
        await writable.close();
        return true;
    } catch(e) {
        console.error('[workbench] WebUSB 保存配置失败:', e);
        return false;
    }
}

async function _wbWebusbDeleteConfig(name) {
    var dir = await _wbGetWebusbDir();
    if (!dir) return false;
    try {
        await dir.removeEntry(name + '.json');
        return true;
    } catch(e) { return false; }
}

function _wbIsWebusbMode() {
    // 项目固定为 WebUSB 模式
    return true;
}

// ===== 状态变量 =====
var _wbSteps = [];            // 步骤列表
var _wbConfigs = [];          // 已导入的配置列表
var _wbCurrentConfig = '';    // 当前选中的配置名
var _wbEditMode = false;      // 是否处于编辑模式（输入框可编辑）
var _wbExecState = 'idle';    // 执行状态：idle/running/paused/done/failed
var _wbPauseStepIdx = 0;     // 暂停时的步骤索引（继续执行从此处开始）
var _wbCurrentStepType = '';  // 当前选中的步骤类型（添加步骤弹窗）
var _wbDragSrcIdx = -1;       // 拖拽源索引
var _wbPickedFiles = {};      // WebUSB 模式下暂存的 File 对象 { fieldName: File }

// ===== 工具函数 =====
function _wbEsc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _wbSetStatus(msg, type) {
    var el = document.getElementById('wbStatusText');
    if (el) el.textContent = msg;
    if (typeof writeLog === 'function') writeLog(msg, type || 'info');
}

function _wbShowOutput(text) {
    var el = document.getElementById('wbOutput');
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML += text + '\n';
    el.scrollTop = el.scrollHeight;
}

function _wbClearOutput() {
    var el = document.getElementById('wbOutput');
    if (el) { el.innerHTML = ''; el.style.display = 'none'; }
}

// 刷写进度跟踪
var _wbFlashStartTime = 0;
var _wbFlashLastUpdate = 0;

function _wbUpdateFlashProgress(pct, partition, totalBytes) {
    var now = Date.now();
    // 限制更新频率到每 500ms 一次，避免 UI 卡顿
    if (now - _wbFlashLastUpdate < 500 && pct < 100) return;
    _wbFlashLastUpdate = now;

    var progressEl = document.getElementById('wbProgress');
    if (progressEl) {
        var pb = progressEl.querySelector('.module-progress-bar');
        var pt = progressEl.querySelector('.module-progress-text');
        if (pb) pb.style.width = pct + '%';
        if (pt) pt.textContent = pct + '%';
    }

    // 计算速度和剩余时间
    var elapsed = (now - _wbFlashStartTime) / 1000;
    var speedStr = '';
    var etaStr = '';
    if (elapsed > 0.5 && pct > 0) {
        var sentBytes = totalBytes * pct / 100;
        var speed = sentBytes / elapsed;
        if (speed > 1024 * 1024) {
            speedStr = (speed / 1024 / 1024).toFixed(1) + ' MB/s';
        } else if (speed > 1024) {
            speedStr = (speed / 1024).toFixed(0) + ' KB/s';
        } else {
            speedStr = speed.toFixed(0) + ' B/s';
        }
        if (pct < 100) {
            var remainingBytes = totalBytes - sentBytes;
            var eta = remainingBytes / speed;
            if (eta > 60) {
                etaStr = Math.floor(eta / 60) + '分' + Math.round(eta % 60) + '秒';
            } else {
                etaStr = Math.round(eta) + '秒';
            }
        }
    }

    var sizeStr = totalBytes > 1024 * 1024 * 1024
        ? (totalBytes / 1024 / 1024 / 1024).toFixed(1) + 'GB'
        : totalBytes > 1024 * 1024
            ? (totalBytes / 1024 / 1024).toFixed(0) + 'MB'
            : (totalBytes / 1024).toFixed(0) + 'KB';

    var msg = '工作台状态：刷写 ' + partition + ' ' + pct + '% (' + sizeStr + ')';
    if (speedStr) msg += ' 速度:' + speedStr;
    if (etaStr) msg += ' 剩余:' + etaStr;
    _wbSetStatus(msg, 'info');
}

// ===== 配置管理 =====

/**
 * 从已授权的根目录解析文件路径，返回 File 对象
 * 支持格式：
 *   - "123456/images/boot.img"（相对路径，从根目录开始遍历）
 *   - "/sdcard/123456/images/boot.img"（绝对路径，去除根目录名后遍历）
 *   - "Phone/123456/images/boot.img"（带根目录名，自动跳过匹配的根目录名）
 * 注意：只能访问已授权根目录范围内的文件，浏览器安全沙箱禁止访问授权范围外的路径
 */
async function _wbResolveFileFromRoot(imagePath) {
    if (!imagePath) return null;

    // 获取已授权的根目录 handle
    var rootHandle = null;
    if (typeof FileApi !== 'undefined' && FileApi.restoreWebusbRootHandle) {
        rootHandle = await FileApi.restoreWebusbRootHandle();
    }
    if (!rootHandle) return null;

    // 清理路径：去除前导斜杠、去除开头的根目录名（如果匹配）
    var cleanPath = imagePath.replace(/^\/+/, '').replace(/^\\+/, '');

    // 如果路径以根目录名开头，去除它（避免重复遍历根目录自身）
    var rootName = rootHandle.name || '';
    if (rootName && cleanPath.toLowerCase().indexOf(rootName.toLowerCase() + '/') === 0) {
        cleanPath = cleanPath.substring(rootName.length + 1);
    }

    // 去除常见的手机存储路径前缀（如 sdcard/、storage/emulated/0/ 等）
    cleanPath = cleanPath.replace(/^(sdcard|storage\/emulated\/0|storage\/self\/primary)\//i, '');

    // 分割路径为各级目录 + 文件名
    var parts = cleanPath.split('/').filter(function(p) { return p && p.length > 0; });
    if (parts.length === 0) return null;

    // 逐级遍历目录，最后一项是文件名
    var currentDir = rootHandle;
    for (var i = 0; i < parts.length - 1; i++) {
        try {
            currentDir = await currentDir.getDirectoryHandle(parts[i]);
        } catch(e) {
            // 目录不存在
            return null;
        }
    }

    // 获取文件
    var fileName = parts[parts.length - 1];
    try {
        var fileHandle = await currentDir.getFileHandle(fileName);
        return await fileHandle.getFile();
    } catch(e) {
        return null;
    }
}

// 检查目录权限，无权限时弹窗提醒
async function _wbEnsureDirPermission() {
    if (typeof window._checkDirPermission === 'function') {
        var hasPerm = await window._checkDirPermission();
        if (!hasPerm) {
            if (typeof showConfirm === 'function') {
                showConfirm('需要目录权限', '当前没有手机目录访问权限，无法保存/加载配置。\n\n请点击顶部胶囊中的「📁 目录」按钮授权权限。', null, false, 0);
            } else if (typeof showToast === 'function') {
                showToast('无目录权限，请点击顶部「📁 目录」按钮授权');
            }
            return false;
        }
    }
    return true;
}

// 加载配置列表
async function _wbLoadConfigs() {
    try {
        if (_wbIsWebusbMode()) {
            // 尝试获取目录，但不强制请求权限（加载时静默）
            var dir = await _wbGetWebusbDir();
            if (!dir) {
                _wbConfigs = [];
                _wbUpdateConfigList();
                _wbUpdateInputPlaceholder();
                return;
            }
            _wbConfigs = await _wbWebusbListConfigs();
            _wbUpdateConfigList();
            _wbUpdateInputPlaceholder();
            if (_wbConfigs.length === 1 && !_wbCurrentConfig) {
                _wbSelectConfig(_wbConfigs[0].name);
            }
            return;
        }
        var resp = await fetch('/api/workbench/configs');
        var data = await resp.json();
        if (data.success) {
            _wbConfigs = data.configs || [];
            _wbUpdateConfigList();
            _wbUpdateInputPlaceholder();
            // 如果只有一个配置，自动选中
            if (_wbConfigs.length === 1 && !_wbCurrentConfig) {
                _wbSelectConfig(_wbConfigs[0].name);
            }
        }
    } catch(e) {
        console.error('[workbench] 加载配置列表失败:', e);
    }
}

// 更新配置下拉框（原生 select，点击即可弹出列表）
function _wbUpdateConfigList() {
    var sel = document.getElementById('wbConfigSelect');
    if (!sel) return;
    var html = '';
    if (_wbConfigs.length === 0) {
        html += '<option value="">暂无配置，请点击「修改」创建</option>';
    } else {
        html += '<option value="">-- 请选择配置 --</option>';
        for (var i = 0; i < _wbConfigs.length; i++) {
            var name = _wbConfigs[i].name;
            var stepCount = _wbConfigs[i].step_count || 0;
            html += '<option value="' + _wbEsc(name) + '">' + _wbEsc(name) + '（' + stepCount + ' 步）</option>';
        }
    }
    sel.innerHTML = html;
    // 恢复当前选中
    if (_wbCurrentConfig) sel.value = _wbCurrentConfig;
}

// 更新输入框提示文字
function _wbUpdateInputPlaceholder() {
    var input = document.getElementById('wbConfigInput');
    if (!input) return;
    if (_wbEditMode) {
        input.placeholder = '请输入新配置名称';
    } else {
        input.placeholder = '请输入配置名称';
    }
}

// 选择配置
async function _wbSelectConfig(name) {
    if (!name) return;
    _wbCurrentConfig = name;
    var sel = document.getElementById('wbConfigSelect');
    if (sel) sel.value = name;
    var input = document.getElementById('wbConfigInput');
    if (input) input.value = name;
    // 加载配置详情
    try {
        if (_wbIsWebusbMode()) {
            var hasPerm = await _wbEnsureDirPermission();
            if (!hasPerm) return;
            var config = await _wbWebusbLoadConfig(name);
            if (config) {
                _wbSteps = config.steps || [];
                _wbRenderSteps();
                _wbSetStatus('工作台状态：已加载配置「' + name + '」（' + _wbSteps.length + ' 步）', 'ok');
            } else {
                _wbSetStatus('工作台状态：加载配置失败', 'err');
            }
            return;
        }
        var resp = await fetch('/api/workbench/configs/' + encodeURIComponent(name));
        var data = await resp.json();
        if (data.success && data.config) {
            _wbSteps = data.config.steps || [];
            _wbRenderSteps();
            _wbSetStatus('工作台状态：已加载配置「' + name + '」（' + _wbSteps.length + ' 步）', 'ok');
        }
    } catch(e) {
        console.error('[workbench] 加载配置详情失败:', e);
    }
}

// 保存配置
async function _wbSaveConfig(name, steps) {
    try {
        if (_wbIsWebusbMode()) {
            // 检查目录读取权限
            var hasPerm = await _wbEnsureDirPermission();
            if (!hasPerm) return false;
            // 保存配置需要 readwrite 权限，在用户手势中请求
            if (typeof window._ensureDirWritePermission === 'function') {
                var hasWrite = await window._ensureDirWritePermission();
                if (!hasWrite) {
                    _wbSetStatus('工作台状态：需要目录写入权限才能保存配置，请点击顶部胶囊「📁 目录」按钮授权', 'err');
                    return false;
                }
            }
            var dir = await _wbGetWebusbDir();
            if (!dir) {
                // 有权限但 handle 丢失，请求用户授权
                dir = await _wbRequestDirAccess();
                if (!dir) return false;
            }
            var ok = await _wbWebusbSaveConfig(name, steps);
            if (ok) {
                _wbCurrentConfig = name;
                await _wbLoadConfigs();
                _wbSetStatus('工作台状态：配置「' + name + '」已保存（' + steps.length + ' 步）', 'ok');
                return true;
            } else {
                _wbSetStatus('工作台状态：保存失败 - 写入文件失败', 'err');
                return false;
            }
        }
        var resp = await fetch('/api/workbench/configs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, steps: steps }),
        });
        var data = await resp.json();
        if (data.success) {
            _wbCurrentConfig = name;
            await _wbLoadConfigs(); // 刷新列表
            _wbSetStatus('工作台状态：配置「' + name + '」已保存（' + steps.length + ' 步）', 'ok');
            return true;
        } else {
            _wbSetStatus('工作台状态：保存失败 - ' + (data.error || '未知错误'), 'err');
            return false;
        }
    } catch(e) {
        _wbSetStatus('工作台状态：保存异常 - ' + e.message, 'err');
        return false;
    }
}

// 删除配置
async function _wbDeleteConfig(name) {
    try {
        if (_wbIsWebusbMode()) {
            var hasPerm = await _wbEnsureDirPermission();
            if (!hasPerm) return;
            var ok = await _wbWebusbDeleteConfig(name);
            if (ok) {
                if (_wbCurrentConfig === name) {
                    _wbCurrentConfig = '';
                    _wbSteps = [];
                    _wbRenderSteps();
                    var input = document.getElementById('wbConfigInput');
                    if (input) input.value = '';
                    var sel = document.getElementById('wbConfigSelect');
                    if (sel) sel.value = '';
                }
                await _wbLoadConfigs();
                _wbSetStatus('工作台状态：配置「' + name + '」已删除', 'ok');
            } else {
                _wbSetStatus('工作台状态：删除失败', 'err');
            }
            return;
        }
        var resp = await fetch('/api/workbench/configs/' + encodeURIComponent(name), { method: 'DELETE' });
        var data = await resp.json();
        if (data.success) {
            if (_wbCurrentConfig === name) {
                _wbCurrentConfig = '';
                _wbSteps = [];
                _wbRenderSteps();
                var input2 = document.getElementById('wbConfigInput');
                if (input2) input2.value = '';
                var sel2 = document.getElementById('wbConfigSelect');
                if (sel2) sel2.value = '';
            }
            await _wbLoadConfigs();
            _wbSetStatus('工作台状态：配置「' + name + '」已删除', 'ok');
        } else {
            _wbSetStatus('工作台状态：删除失败 - ' + (data.error || '未知错误'), 'err');
        }
    } catch(e) {
        _wbSetStatus('工作台状态：删除异常 - ' + e.message, 'err');
    }
}

// 导出配置
async function _wbExportConfig() {
    if (!_wbCurrentConfig) {
        _wbSetStatus('工作台状态：请先选择要导出的配置', 'warn');
        if (typeof showToast === 'function') showToast('请先选择要导出的配置');
        return;
    }
    try {
        // 使用文件选择器选择导出目录
        var dirResult = await FileApi.pickFile({ mode: 'dir' });
        if (!dirResult || !dirResult.path) return;
        var exportPath = dirResult.path.replace(/\/+$/, '') + '/' + _wbCurrentConfig + '.json';
        var resp = await fetch('/api/workbench/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: _wbCurrentConfig, path: exportPath }),
        });
        var data = await resp.json();
        if (data.success) {
            _wbSetStatus('工作台状态：配置已导出到 ' + data.path, 'ok');
            if (typeof showToast === 'function') showToast('配置已导出');
        } else {
            _wbSetStatus('工作台状态：导出失败 - ' + (data.error || '未知错误'), 'err');
        }
    } catch(e) {
        _wbSetStatus('工作台状态：导出异常 - ' + e.message, 'err');
    }
}

// 导入配置
async function _wbImportConfig() {
    try {
        var file = await FileApi.pickFile({ filter: '.json' });
        if (!file || !file.path) return;
        var resp = await fetch('/api/workbench/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: file.path }),
        });
        var data = await resp.json();
        if (data.success) {
            await _wbLoadConfigs();
            _wbSelectConfig(data.name);
            _wbSetStatus('工作台状态：配置「' + data.name + '」已导入（' + data.step_count + ' 步）', 'ok');
            if (typeof showToast === 'function') showToast('配置已导入');
        } else {
            _wbSetStatus('工作台状态：导入失败 - ' + (data.error || '未知错误'), 'err');
        }
    } catch(e) {
        _wbSetStatus('工作台状态：导入异常 - ' + e.message, 'err');
    }
}

// 自动保存（步骤修改后自动保存到当前配置）
var _wbAutoSaveTimer = null;
function _wbAutoSave() {
    if (!_wbCurrentConfig || _wbEditMode) return; // 编辑模式下不自动保存
    if (_wbAutoSaveTimer) clearTimeout(_wbAutoSaveTimer);
    _wbAutoSaveTimer = setTimeout(function() {
        _wbSaveConfig(_wbCurrentConfig, _wbSteps);
    }, 1000);
}

// ===== 配置栏交互 =====

// 切换编辑模式：非编辑模式显示 select（点击弹出列表），编辑模式显示 input（输入新名称）
function _wbToggleEdit() {
    var sel = document.getElementById('wbConfigSelect');
    var input = document.getElementById('wbConfigInput');
    var btn = document.getElementById('wbEditBtn');
    if (!sel || !input || !btn) return;

    if (!_wbEditMode) {
        // 进入编辑模式：隐藏 select，显示 input
        _wbEditMode = true;
        sel.style.display = 'none';
        input.style.display = '';
        input.value = _wbCurrentConfig || '';
        input.focus();
        input.select();
        btn.textContent = '确认';
        btn.classList.add('btn-success');
        _wbUpdateInputPlaceholder();
    } else {
        // 确认保存
        var name = input.value.trim();
        if (!name) {
            _wbSetStatus('工作台状态：配置名称不能为空', 'warn');
            return;
        }
        _wbSaveConfig(name, _wbSteps).then(function(ok) {
            if (ok) {
                _wbEditMode = false;
                input.style.display = 'none';
                sel.style.display = '';
                btn.textContent = '修改';
                btn.classList.remove('btn-success');
                _wbUpdateInputPlaceholder();
            }
        });
    }
}

// 配置下拉框 change 事件（非编辑模式下选择配置）
function _wbOnSelectChange() {
    if (_wbEditMode) return;
    var sel = document.getElementById('wbConfigSelect');
    if (!sel) return;
    var name = sel.value.trim();
    if (!name) return; // 选中空选项（提示项）不处理
    if (name === _wbCurrentConfig) return;
    _wbSelectConfig(name);
}

// ===== 步骤列表 =====

// 步骤描述
function _wbStepDescription(s) {
    var p = s.partition || '';
    switch (s.type) {
        case 'flash':
            return '刷写 <b>' + _wbEsc(p || '未知') + '</b> 分区';
        case 'flash-args-front':
            return '刷写 <b>' + _wbEsc(p || '未知') + '</b>（参数在前）';
        case 'flash-args-back':
            return '刷写 <b>' + _wbEsc(p || '未知') + '</b>（参数在后）';
        case 'flash-dir':
            return '遍历目录 <b>' + _wbEsc(s.dir || '') + '</b> 刷写镜像';
        case 'cow':
            return '清理 COW <b>' + _wbEsc(p || '未知') + '</b>';
        case 'erase':
            return '擦除 <b>' + _wbEsc(p || '未知') + '</b> 分区';
        case 'reboot':
            var tm = { bootloader: 'Bootloader', recovery: 'Recovery', system: '系统', fastboot: 'Fastbootd' };
            return '重启到 <b>' + _wbEsc(tm[p] || p || '系统') + '</b>';
        case 'flashing':
            if (/unlock/i.test(s.raw||'')) return '<b>解锁 Bootloader</b>';
            if (/lock/i.test(s.raw||'')) return '<b>上锁 Bootloader</b>';
            return '执行 Flashing 命令';
        case 'getvar':
            return '查询 <b>' + _wbEsc(p || s.raw || '') + '</b>';
        case 'custom':
        case 'quick':
        case 'raw':
        default:
            return '执行 <b>' + _wbEsc(s.label || s.raw || '命令') + '</b>';
    }
}

// 渲染步骤列表
function _wbRenderSteps() {
    var container = document.getElementById('wbStepList');
    if (!container) return;
    if (!_wbSteps.length) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">请先选择或创建配置，然后添加步骤</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < _wbSteps.length; i++) {
        var s = _wbSteps[i];
        var raw = s.raw || '';
        var levelClass = 'step-item';
        if (s.level === 'danger') levelClass += ' step-item-danger';
        if (s.level === 'warn') levelClass += ' step-item-warn';

        html += '<div class="' + levelClass + '" data-step-idx="' + i + '" draggable="true">';
        html += '  <div class="step-item-header">';
        html += '    <div class="step-item-left">';
        html += '      <span class="step-num">' + (i + 1) + '</span>';
        html += '      <span class="step-desc">' + _wbStepDescription(s) + '</span>';
        html += '    </div>';
        html += '    <div class="step-item-right">';
        html += '      <button class="step-run-btn" data-run-idx="' + i + '" title="单独执行">▶</button>';
        html += '      <button class="step-del-btn" data-del-idx="' + i + '">删除</button>';
        html += '    </div>';
        html += '  </div>';
        if (raw) html += '  <div class="step-cmd">' + _wbEsc(raw) + '</div>';
        html += '</div>';
    }
    container.innerHTML = html;

    // 绑定删除按钮
    var delBtns = container.querySelectorAll('[data-del-idx]');
    for (var d = 0; d < delBtns.length; d++) {
        delBtns[d].onclick = function() {
            if (_wbExecState === 'running') return;
            var idx = parseInt(this.getAttribute('data-del-idx'));
            _wbSteps.splice(idx, 1);
            _wbRenderSteps();
            _wbAutoSave();
        };
    }

    // 绑定单独执行按钮
    var runBtns = container.querySelectorAll('[data-run-idx]');
    for (var r = 0; r < runBtns.length; r++) {
        runBtns[r].onclick = function() {
            if (_wbExecState === 'running') return;
            var idx = parseInt(this.getAttribute('data-run-idx'));
            _wbExecSingle(idx);
        };
    }

    // 绑定拖拽事件
    _wbBindDragEvents(container);
}

// 绑定拖拽排序事件
function _wbBindDragEvents(container) {
    var items = container.querySelectorAll('.step-item[draggable="true"]');
    for (var i = 0; i < items.length; i++) {
        items[i].addEventListener('dragstart', function(e) {
            _wbDragSrcIdx = parseInt(this.getAttribute('data-step-idx'));
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        items[i].addEventListener('dragend', function(e) {
            this.classList.remove('dragging');
            _wbDragSrcIdx = -1;
        });
        items[i].addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.classList.add('drag-over');
        });
        items[i].addEventListener('dragleave', function(e) {
            this.classList.remove('drag-over');
        });
        items[i].addEventListener('drop', function(e) {
            e.preventDefault();
            this.classList.remove('drag-over');
            var destIdx = parseInt(this.getAttribute('data-step-idx'));
            if (_wbDragSrcIdx >= 0 && _wbDragSrcIdx !== destIdx) {
                // 移动数组元素
                var moved = _wbSteps.splice(_wbDragSrcIdx, 1)[0];
                _wbSteps.splice(destIdx, 0, moved);
                _wbRenderSteps();
                _wbAutoSave();
            }
        });
    }
}

// ===== 命令路由：WebUSB 模式 / 后端模式 =====

/**
 * 执行单个工作台步骤的 fastboot 命令，自动路由到 WebUSB 或后端。
 * @param {Object} step - 步骤对象 { raw, type, partition, image, ... }
 * @returns {Promise<{success: boolean, output: string}>}
 */
async function _wbRunFastbootCommand(step) {
    try {
    var args = (step.raw || '').split(/\s+/).filter(Boolean);
    if (!args.length) {
        return { success: false, output: '该步骤没有可执行的命令' };
    }

    // ===== WebUSB 模式（唯一路径） =====
    if (typeof webusbFastbootReady !== 'undefined' && webusbFastbootReady) {
        var cmd = String(args[0] || '').toLowerCase();

        // flash 命令：通过暂存的 File 对象或 FileSystemFileHandle 读取镜像，再通过 WebUSB 刷写
        if (cmd === 'flash') {
            var partition = args[1];
            var imagePath = args[2];
            _wbFlashStartTime = Date.now();  // 初始化进度计时
            if (!partition || !imagePath) {
                return { success: false, output: 'flash 命令缺少分区名或镜像路径' };
            }
            // 优先使用暂存的 File 对象（WebUSB 模式下浏览器选择的文件，Blob 流式传输避免内存爆炸）
            // 或通过 FileSystemFileHandle 恢复文件（页面刷新后 File 对象丢失但 handle 仍在 IndexedDB）
            var flashPayload = null;
            var flashPayloadSize = 0;

            if (step.fileObj && step.fileObj instanceof Blob) {
                // 有 File 对象：直接使用
                flashPayload = step.fileObj;
                flashPayloadSize = step.fileObj.size;
            } else if (step.fileHandle && typeof FileApi !== 'undefined' && FileApi.getFileFromHandle) {
                // 有 fileHandle：通过 handle 恢复 File 对象（解决页面刷新后 fileObj 丢失问题）
                try {
                    flashPayload = await FileApi.getFileFromHandle(step.fileHandle);
                    flashPayloadSize = flashPayload ? flashPayload.size : 0;
                } catch(handleErr) {
                    // handle 失效，尝试路径解析
                }
            }

            // 无 File 对象和 handle：尝试从已授权的根目录解析路径
            if (!flashPayload && imagePath) {
                try {
                    var resolvedFile = await _wbResolveFileFromRoot(imagePath);
                    if (resolvedFile) {
                        flashPayload = resolvedFile;
                        flashPayloadSize = resolvedFile.size;
                        _wbSetStatus('工作台状态：通过路径解析读取文件 ' + imagePath + ' (' + (flashPayloadSize / 1024 / 1024).toFixed(1) + ' MB)', 'info');
                    }
                } catch(resolveErr) {
                    // 路径解析失败，继续到下面的错误提示
                }
            }

            if (flashPayload) {
                if (typeof runWebUsbFastbootCommand !== 'function') {
                    return { success: false, output: 'WebUSB 模块未加载' };
                }
                try {
                    var flashResult = await runWebUsbFastbootCommand({
                        command: 'flash',
                        partition: partition,
                        payload: flashPayload,
                        onProgress: function(pct) { _wbUpdateFlashProgress(pct, partition, flashPayloadSize); }
                    });
                    return { success: true, output: flashResult || ('已刷写 ' + partition) };
                } catch(e) {
                    return { success: false, output: 'WebUSB 刷写失败: ' + e.message };
                }
            }
            // 无 File 对象且路径解析失败
            return {
                success: false,
                output: '无法读取镜像文件。可能原因：\n1. 文件对象已失效（页面刷新后丢失），请重新选择文件\n2. 输入的路径不在已授权目录范围内\n3. 未授权目录权限，请点击顶部胶囊「📁 目录」按钮授权\n路径：' + imagePath
            };
        }

        // delete-logical-partition（COW 清理）：WebUSB fastboot.mjs 不支持
        if (cmd === 'delete-logical-partition') {
            return {
                success: false,
                output: 'WebUSB 模式不支持 delete-logical-partition 命令（COW 清理）'
            };
        }

        // 其他命令：通过 fastbootArgsToWebUsbCommand 路由
        if (typeof fastbootArgsToWebUsbCommand !== 'function' || typeof runWebUsbFastbootCommand !== 'function') {
            return { success: false, output: 'WebUSB 模块未加载' };
        }
        var cmdObj = fastbootArgsToWebUsbCommand(args);
        if (!cmdObj) {
            return { success: false, output: 'WebUSB 模式不支持该命令: ' + args.join(' ') };
        }
        try {
            var result = await runWebUsbFastbootCommand(cmdObj);
            return { success: true, output: result || '完成' };
        } catch(e) {
            return { success: false, output: 'WebUSB 命令执行失败: ' + e.message };
        }
    }

    // WebUSB 设备未连接
    return { success: false, output: 'Fastboot设备未连接，请先在顶部胶囊点击设备检测连接' };
    } catch(e) {
        return { success: false, output: '执行异常: ' + e.message };
    }
}

// ===== 单独执行步骤 =====
async function _wbExecSingle(idx) {
    if (idx < 0 || idx >= _wbSteps.length) return;
    var s = _wbSteps[idx];
    var args = (s.raw || '').split(/\s+/).filter(Boolean);
    if (!args.length) {
        _wbSetStatus('工作台状态：该步骤没有可执行的命令', 'warn');
        return;
    }
    _wbSetStatus('工作台状态：正在执行步骤 ' + (idx + 1) + '...', 'info');
    _wbShowOutput('▶ [步骤 ' + (idx + 1) + '] fastboot ' + args.join(' '));
    try {
        var result = await _wbRunFastbootCommand(s);
        if (result.success) {
            if (result.output) _wbShowOutput(result.output);
            _wbShowOutput('✓ 步骤 ' + (idx + 1) + ' 完成');
            _wbSetStatus('工作台状态：步骤 ' + (idx + 1) + ' 执行完成', 'ok');
        } else {
            _wbShowOutput('✗ 步骤 ' + (idx + 1) + ' 失败: ' + result.output);
            _wbSetStatus('工作台状态：步骤 ' + (idx + 1) + ' 失败', 'err');
        }
    } catch(e) {
        _wbShowOutput('✗ 步骤 ' + (idx + 1) + ' 异常: ' + e.message);
        _wbSetStatus('工作台状态：步骤 ' + (idx + 1) + ' 异常', 'err');
    }
}

// ===== 添加步骤弹窗 =====

// 显示添加步骤弹窗
function _wbShowAddStepDialog() {
    var dialog = document.getElementById('wbAddStepDialog');
    if (!dialog) return;
    // 重置到卡片选择页
    document.getElementById('wbStepCards').style.display = '';
    document.getElementById('wbStepForm').style.display = 'none';
    _wbCurrentStepType = '';
    dialog.style.display = 'flex';
}

// 关闭添加步骤弹窗
function _wbCloseAddStepDialog() {
    var dialog = document.getElementById('wbAddStepDialog');
    if (dialog) dialog.style.display = 'none';
}

// 选择步骤类型（卡片点击）
function _wbSelectStepType(type) {
    _wbCurrentStepType = type;
    document.getElementById('wbStepCards').style.display = 'none';
    document.getElementById('wbStepForm').style.display = '';
    var content = document.getElementById('wbStepFormContent');
    var title = document.getElementById('wbAddStepDialogTitle');

    var titles = {
        'flash': '刷写镜像',
        'flash-args-front': '刷写镜像（参数在前）',
        'flash-args-back': '刷写镜像（参数在后）',
        'flash-dir': '遍历目录镜像',
        'cow': 'COW 分区清理',
        'custom': '自定义 Fastboot 命令',
    };
    title.textContent = titles[type] || '添加步骤';

    switch(type) {
        case 'flash':
            content.innerHTML = _wbFormFlash(false);
            break;
        case 'flash-args-front':
            content.innerHTML = _wbFormFlash(true, 'front');
            break;
        case 'flash-args-back':
            content.innerHTML = _wbFormFlash(true, 'back');
            break;
        case 'flash-dir':
            content.innerHTML = _wbFormFlashDir();
            break;
        case 'cow':
            content.innerHTML = _wbFormCow();
            break;
        case 'custom':
            content.innerHTML = _wbFormCustom();
            break;
    }
}

// 返回卡片选择
function _wbBackToCards() {
    document.getElementById('wbStepCards').style.display = '';
    document.getElementById('wbStepForm').style.display = 'none';
    _wbCurrentStepType = '';
    document.getElementById('wbAddStepDialogTitle').textContent = '添加步骤';
}

// 表单：刷写镜像
function _wbFormFlash(hasArgs, argsPos) {
    var argsHtml = '';
    if (hasArgs) {
        argsHtml = '<div class="wb-form-row">';
        argsHtml += '<label>附加参数</label>';
        argsHtml += '<input type="text" id="wbFormArgs" placeholder="如 --disable-verity --disable-verification">';
        argsHtml += '</div>';
    }
    return '<div class="wb-form-row">' +
        '<label>分区名</label>' +
        '<input type="text" id="wbFormPartition" placeholder="如 boot、dtbo、vbmeta">' +
        '</div>' +
        '<div class="wb-form-row">' +
        '<label>镜像路径</label>' +
        '<div class="wb-form-input-group">' +
        '<input type="text" id="wbFormImage" placeholder="镜像绝对路径">' +
        '<button class="btn small secondary" data-action="wb-pick-image">📁</button>' +
        '</div>' +
        '</div>' + argsHtml;
}

// 表单：遍历目录镜像
function _wbFormFlashDir() {
    return '<div class="wb-form-row">' +
        '<label>镜像目录</label>' +
        '<div class="wb-form-input-group">' +
        '<input type="text" id="wbFormDir" placeholder="选择包含镜像的目录">' +
        '<button class="btn small secondary" data-action="wb-pick-dir">📁</button>' +
        '</div>' +
        '</div>' +
        '<div class="wb-form-row">' +
        '<label>文件后缀</label>' +
        '<input type="text" id="wbFormSuffix" value=".img" placeholder="如 .img">' +
        '</div>' +
        '<div class="wb-form-row wb-form-checkbox">' +
        '<label><input type="checkbox" id="wbFormAB"> AB 机型</label>' +
        '<div class="wb-form-hint" id="wbABHint" style="display:none;">勾选后：如果目录中任何一个镜像带 _a/_b 则全部以默认方式刷写（不补全）；如果所有镜像都不带 _a/_b 则每个镜像补全为同文件刷到 _a 和 _b 两个分区</div>' +
        '</div>';
}

// 表单：COW 分区清理
function _wbFormCow() {
    return '<div class="wb-form-row">' +
        '<label>分区名</label>' +
        '<input type="text" id="wbFormPartition" placeholder="如 boot（将清理 boot-cow）">' +
        '</div>' +
        '<div class="wb-form-row wb-form-checkbox">' +
        '<label><input type="checkbox" id="wbFormAB"> AB 机型</label>' +
        '<div class="wb-form-hint" id="wbABHint" style="display:none;">勾选后：输入 boot 将自动补全 boot_a-cow 和 boot_b-cow 两条步骤</div>' +
        '</div>';
}

// 表单：自定义 Fastboot 命令
function _wbFormCustom() {
    return '<div class="wb-form-row">' +
        '<label>fastboot 命令参数</label>' +
        '<input type="text" id="wbFormCmd" placeholder="如 flash boot /sdcard/boot.img 或 reboot bootloader">' +
        '</div>' +
        '<div class="wb-form-row">' +
        '<label>步骤描述（可选）</label>' +
        '<input type="text" id="wbFormLabel" placeholder="如 刷写 boot 分区">' +
        '</div>';
}

// 选择镜像文件（使用内置文件管理器，权限来源自全局胶囊的目录按钮）
async function _wbPickImage() {
    try {
        // 检查目录权限，无权限时弹窗提醒
        var hasPerm = await _wbEnsureDirPermission();
        if (!hasPerm) return;

        // 获取已授权的根目录 handle
        var rootHandle = null;
        if (typeof FileApi !== 'undefined' && FileApi.restoreWebusbRootHandle) {
            rootHandle = await FileApi.restoreWebusbRootHandle();
        }

        // 使用内置文件管理器选择文件
        var result = await FilePicker.pick({
            mode: 'file',
            filter: '.img,.bin,.elf',
            webusb: true,
            rootDirHandle: rootHandle || undefined,
        });

        if (!result) return;

        var input = document.getElementById('wbFormImage');
        if (!input) return;

        // 使用完整路径作为显示值（便于后续路径解析）
        var displayPath = result.path || result.name;
        input.value = displayPath;

        // 存储 File 对象和 FileSystemFileHandle（刷新后可通过 handle 恢复）
        if (result.file) {
            _wbPickedFiles['wbFormImage'] = result.file;
        } else if (result.fileHandle) {
            try {
                var file = await result.fileHandle.getFile();
                _wbPickedFiles['wbFormImage'] = file;
            } catch(e) { /* ignore */ }
        }
        _wbPickedFiles['wbFormImageHandle'] = result.fileHandle || null;

        var fileSize = (_wbPickedFiles['wbFormImage'] && _wbPickedFiles['wbFormImage'].size) || 0;
        var sizeStr = fileSize > 1024 * 1024
            ? (fileSize / 1024 / 1024).toFixed(1) + ' MB'
            : (fileSize / 1024).toFixed(0) + ' KB';
        _wbSetStatus('工作台状态：已选择文件 ' + result.name + ' (' + sizeStr + ')', 'ok');
    } catch(e) {
        if (e && e.message && e.message.indexOf('取消') >= 0) {
            // 用户取消选择，静默处理
        } else {
            _wbSetStatus('工作台状态：选择文件失败 - ' + (e.message || e), 'err');
        }
    }
}

// 选择目录（使用内置文件管理器，权限来源自全局胶囊的目录按钮）
async function _wbPickDir() {
    try {
        // 检查目录权限，无权限时弹窗提醒
        var hasPerm = await _wbEnsureDirPermission();
        if (!hasPerm) return;

        // 获取已授权的根目录 handle
        var rootHandle = null;
        if (typeof FileApi !== 'undefined' && FileApi.restoreWebusbRootHandle) {
            rootHandle = await FileApi.restoreWebusbRootHandle();
        }

        // 使用内置文件管理器选择目录
        var result = await FilePicker.pick({
            mode: 'dir',
            webusb: true,
            rootDirHandle: rootHandle || undefined,
        });

        if (!result) return;

        var input = document.getElementById('wbFormDir');
        if (!input) return;

        var dirName = result.name || '所选目录';
        input.value = dirName;

        // 遍历选中的目录获取所有文件（含子目录）
        var files = [];
        var dirHandle = result.dirHandle;

        if (dirHandle) {
            async function _traverseDir(handle) {
                for await (var entry of handle.values()) {
                    if (entry.kind === 'file') {
                        try {
                            var file = await entry.getFile();
                            files.push(file);
                        } catch(e) { /* skip unreadable */ }
                    } else if (entry.kind === 'directory') {
                        await _traverseDir(entry);
                    }
                }
            }
            await _traverseDir(dirHandle);
        }

        _wbPickedFiles['wbFormDirFiles'] = files;
        _wbPickedFiles['wbFormDirHandle'] = dirHandle;
        _wbPickedFiles['wbFormDirName'] = dirName;

        var imgCount = files.filter(function(f) {
            return f.name.endsWith('.img') || f.name.endsWith('.bin') || f.name.endsWith('.elf');
        }).length;
        _wbSetStatus('工作台状态：已选择目录 ' + dirName + '（共 ' + files.length + ' 个文件，' + imgCount + ' 个镜像）', 'ok');
    } catch(e) {
        if (e && e.message && e.message.indexOf('取消') >= 0) {
            // 用户取消选择，静默处理
        } else {
            _wbSetStatus('工作台状态：选择目录失败 - ' + (e.message || e), 'err');
        }
    }
}

// 确认添加步骤
async function _wbAddStepConfirm() {
    var type = _wbCurrentStepType;
    var newSteps = [];

    switch(type) {
        case 'flash':
        case 'flash-args-front':
        case 'flash-args-back': {
            var partition = (document.getElementById('wbFormPartition').value || '').trim();
            var image = (document.getElementById('wbFormImage').value || '').trim();
            var args = '';
            if (type === 'flash-args-front' || type === 'flash-args-back') {
                args = (document.getElementById('wbFormArgs').value || '').trim();
            }
            if (!partition || !image) {
                _wbSetStatus('工作台状态：分区名和镜像路径不能为空', 'warn');
                return;
            }
            var raw;
            if (type === 'flash-args-front' && args) {
                raw = args + ' flash ' + partition + ' ' + image;
            } else if (type === 'flash-args-back' && args) {
                raw = 'flash ' + partition + ' ' + image + ' ' + args;
            } else {
                raw = 'flash ' + partition + ' ' + image;
            }
            newSteps.push({
                type: type,
                partition: partition,
                image: image,
                args: args,
                raw: raw,
                label: '刷写 ' + partition,
                level: 'danger',
                fileObj: _wbPickedFiles['wbFormImage'] || null,  // WebUSB 模式下保留 File 对象
                fileHandle: _wbPickedFiles['wbFormImageHandle'] || null,  // FileSystemFileHandle（刷新后可恢复）
            });
            break;
        }
        case 'flash-dir': {
            var dir = (document.getElementById('wbFormDir').value || '').trim();
            var suffix = (document.getElementById('wbFormSuffix').value || '.img').trim();
            var isAB = document.getElementById('wbFormAB').checked;
            if (!dir) {
                _wbSetStatus('工作台状态：镜像目录不能为空', 'warn');
                return;
            }
            // 获取目录中的镜像文件
            try {
                var images = [];
                var dirFiles = _wbPickedFiles['wbFormDirFiles'] || null;

                if (dirFiles && dirFiles.length) {
                    // 浏览器原生目录选择：直接遍历 File 对象数组
                    for (var di = 0; di < dirFiles.length; di++) {
                        var dirFile = dirFiles[di];
                        if (dirFile.name.endsWith(suffix)) {
                            var relPath = dirFile.webkitRelativePath || dirFile.name;
                            images.push({
                                name: dirFile.name,
                                abs_path: relPath,
                                fileObj: dirFile,
                                fileHandle: null,
                                size: dirFile.size,
                            });
                        }
                    }
                } else {
                    _wbSetStatus('工作台状态：目录文件不可用，请重新选择目录', 'err');
                    return;
                }

                if (!images.length) {
                    _wbSetStatus('工作台状态：目录中没有找到 ' + suffix + ' 文件', 'warn');
                    return;
                }
                // 检查是否有 _a/_b 镜像（使用动态后缀）
                var abPattern = new RegExp('_a' + suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$|_b' + suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
                var hasAB = false;
                for (var j = 0; j < images.length; j++) {
                    if (abPattern.test(images[j].name)) {
                        hasAB = true;
                        break;
                    }
                }
                for (var k = 0; k < images.length; k++) {
                    var img = images[k];
                    var partitionName = img.name.replace(suffix, '');
                    if (isAB && hasAB) {
                        // AB 机型且目录已有 _a/_b：直接刷写
                        newSteps.push({
                            type: 'flash-dir',
                            partition: partitionName,
                            image: img.abs_path,
                            raw: 'flash ' + partitionName + ' ' + img.abs_path,
                            label: '刷写 ' + partitionName,
                            dir: dir,
                            level: 'danger',
                            fileObj: img.fileObj || null,
                            fileHandle: img.fileHandle || null,
                        });
                    } else if (isAB && !hasAB) {
                        // AB 机型但目录无 _a/_b：同一文件刷到 _a 和 _b
                        newSteps.push({
                            type: 'flash-dir',
                            partition: partitionName + '_a',
                            image: img.abs_path,
                            raw: 'flash ' + partitionName + '_a ' + img.abs_path,
                            label: '刷写 ' + partitionName + '_a',
                            dir: dir,
                            level: 'danger',
                            fileObj: img.fileObj || null,
                            fileHandle: img.fileHandle || null,
                        });
                        newSteps.push({
                            type: 'flash-dir',
                            partition: partitionName + '_b',
                            image: img.abs_path,
                            raw: 'flash ' + partitionName + '_b ' + img.abs_path,
                            label: '刷写 ' + partitionName + '_b',
                            dir: dir,
                            level: 'danger',
                            fileObj: img.fileObj || null,
                            fileHandle: img.fileHandle || null,
                        });
                    } else {
                        // 非 AB：直接刷写
                        newSteps.push({
                            type: 'flash-dir',
                            partition: partitionName,
                            image: img.abs_path,
                            raw: 'flash ' + partitionName + ' ' + img.abs_path,
                            label: '刷写 ' + partitionName,
                            dir: dir,
                            level: 'danger',
                            fileObj: img.fileObj || null,
                            fileHandle: img.fileHandle || null,
                        });
                    }
                }
            } catch(e) {
                _wbSetStatus('工作台状态：读取目录异常 - ' + e.message, 'err');
                return;
            }
            break;
        }
        case 'cow': {
            var cowPartition = (document.getElementById('wbFormPartition').value || '').trim();
            var cowAB = document.getElementById('wbFormAB').checked;
            if (!cowPartition) {
                _wbSetStatus('工作台状态：分区名不能为空', 'warn');
                return;
            }
            if (cowAB) {
                newSteps.push({
                    type: 'cow',
                    partition: cowPartition + '_a',
                    raw: 'delete-logical-partition ' + cowPartition + '_a-cow',
                    label: '清理 ' + cowPartition + '_a-cow',
                    level: 'warn',
                });
                newSteps.push({
                    type: 'cow',
                    partition: cowPartition + '_b',
                    raw: 'delete-logical-partition ' + cowPartition + '_b-cow',
                    label: '清理 ' + cowPartition + '_b-cow',
                    level: 'warn',
                });
            } else {
                newSteps.push({
                    type: 'cow',
                    partition: cowPartition,
                    raw: 'delete-logical-partition ' + cowPartition + '-cow',
                    label: '清理 ' + cowPartition + '-cow',
                    level: 'warn',
                });
            }
            break;
        }
        case 'custom': {
            var cmd = (document.getElementById('wbFormCmd').value || '').trim();
            var label = (document.getElementById('wbFormLabel').value || '').trim();
            if (!cmd) {
                _wbSetStatus('工作台状态：命令不能为空', 'warn');
                return;
            }
            newSteps.push({
                type: 'custom',
                raw: cmd,
                label: label || '自定义命令',
                level: 'warn',
            });
            break;
        }
    }

    // 添加步骤到列表
    for (var m = 0; m < newSteps.length; m++) {
        _wbSteps.push(newSteps[m]);
    }
    _wbRenderSteps();
    _wbAutoSave();
    _wbCloseAddStepDialog();
    _wbSetStatus('工作台状态：已添加 ' + newSteps.length + ' 个步骤', 'ok');
}

// ===== Fastboot 快捷命令弹窗 =====

function _wbShowFastbootDialog() {
    var dialog = document.getElementById('wbFastbootDialog');
    if (dialog) dialog.style.display = 'flex';
}

function _wbCloseFastbootDialog() {
    var dialog = document.getElementById('wbFastbootDialog');
    if (dialog) dialog.style.display = 'none';
}

// 添加快捷命令到步骤列表
function _wbAddQuickStep(cmd, label) {
    var level = 'safe';
    if (/erase|format|-w|unlock|lock|flash/i.test(cmd)) level = 'danger';
    else if (/reboot/i.test(cmd)) level = 'warn';

    // 判断类型
    var type = 'quick';
    var partition = '';
    if (/^flash\s+(\S+)/.test(cmd)) {
        type = 'flash';
        partition = cmd.match(/^flash\s+(\S+)/)[1];
    } else if (/^erase\s+(\S+)/.test(cmd)) {
        type = 'erase';
        partition = cmd.match(/^erase\s+(\S+)/)[1];
    } else if (/^reboot\s*(\S*)/.test(cmd)) {
        type = 'reboot';
        partition = cmd.match(/^reboot\s*(\S*)/)[1] || 'system';
    } else if (/^flashing\s+(\S+)/.test(cmd)) {
        type = 'flashing';
    } else if (/^getvar\s+(\S+)/.test(cmd)) {
        type = 'getvar';
        partition = cmd.match(/^getvar\s+(\S+)/)[1];
    }

    _wbSteps.push({
        type: type,
        partition: partition,
        raw: cmd,
        label: label,
        level: level,
    });
    _wbRenderSteps();
    _wbAutoSave();
    _wbSetStatus('工作台状态：已添加「' + label + '」', 'ok');
}

// ===== 执行栏 =====

// 全部执行
async function _wbExecuteAll() {
    var btn = document.getElementById('wbExecuteBtn');
    if (_wbExecState === 'idle' || _wbExecState === 'done' || _wbExecState === 'failed') {
        if (!_wbSteps.length) {
            _wbSetStatus('工作台状态：步骤列表为空', 'warn');
            return;
        }
        if (!canFastboot && !webusbFastbootReady) {
            _wbSetStatus('工作台状态：请先检测到 Fastboot 设备', 'warn');
            if (typeof showToast === 'function') showToast('请先检测到 Fastboot 设备');
            return;
        }
        _wbExecState = 'running';
        if (btn) { btn.textContent = '暂停'; btn.classList.remove('warn'); btn.classList.add('secondary'); }
        _wbClearOutput();
        _wbShowOutput('开始执行全部步骤（共 ' + _wbSteps.length + ' 步）');
        await _wbExecuteFromIndex(0);
    } else if (_wbExecState === 'running') {
        // 暂停：仅在步骤间生效，正在执行的步骤会继续完成
        _wbExecState = 'paused';
        if (btn) { btn.textContent = '继续'; }
        _wbSetStatus('工作台状态：暂停中（当前步骤完成后生效）', 'warn');
    } else if (_wbExecState === 'paused') {
        // 继续：从暂停位置恢复执行
        _wbExecState = 'running';
        if (btn) { btn.textContent = '暂停'; btn.classList.remove('warn'); btn.classList.add('secondary'); }
        _wbSetStatus('工作台状态：继续执行...', 'info');
        // 找到第一个未完成的步骤继续执行
        await _wbExecuteFromIndex(_wbPauseStepIdx);
    }
}

// 从指定索引执行
async function _wbExecuteFromIndex(startIdx) {
    var progressEl = document.getElementById('wbProgress');
    var btn = document.getElementById('wbExecuteBtn');
    if (progressEl) progressEl.style.display = 'flex';

    for (var i = startIdx; i < _wbSteps.length; i++) {
        // 检查暂停状态（在步骤开始前）
        if (_wbExecState === 'paused') {
            _wbPauseStepIdx = i;
            return;
        }
        if (_wbExecState !== 'running') return; // 停止

        var s = _wbSteps[i];
        var args = (s.raw || '').split(/\s+/).filter(Boolean);
        if (!args.length) continue;

        // 更新进度
        var pct = parseInt((i / _wbSteps.length) * 100);
        if (progressEl) {
            var pb = progressEl.querySelector('.module-progress-bar');
            var pt = progressEl.querySelector('.module-progress-text');
            if (pb) pb.style.width = pct + '%';
            if (pt) pt.textContent = pct + '%';
        }
        _wbSetStatus('工作台状态：执行步骤 ' + (i + 1) + '/' + _wbSteps.length + '...', 'info');
        _wbShowOutput('▶ [步骤 ' + (i + 1) + '/' + _wbSteps.length + '] fastboot ' + args.join(' '));

        try {
            var result = await _wbRunFastbootCommand(s);
            if (result.success) {
                if (result.output) _wbShowOutput(result.output);
                _wbShowOutput('✓ 步骤 ' + (i + 1) + ' 完成');
                // 步骤完成后检查是否在暂停期间——如果是最后一步，直接完成
                if (_wbExecState === 'paused') {
                    _wbPauseStepIdx = i + 1;  // 下次继续从下一步开始
                    if (i + 1 >= _wbSteps.length) {
                        // 暂停时已经是最后一步，直接完成
                        break;
                    }
                    return;  // 等待用户继续
                }
            } else {
                _wbShowOutput('✗ 步骤 ' + (i + 1) + ' 失败: ' + result.output);
                _wbExecState = 'failed';
                if (btn) { btn.textContent = '全部执行'; btn.classList.add('warn'); btn.classList.remove('secondary'); }
                _wbSetStatus('工作台状态：步骤 ' + (i + 1) + ' 失败 - ' + result.output, 'err');
                return;
            }
        } catch(e) {
            _wbShowOutput('✗ 步骤 ' + (i + 1) + ' 异常: ' + e.message);
            _wbExecState = 'failed';
            if (btn) { btn.textContent = '全部执行'; btn.classList.add('warn'); btn.classList.remove('secondary'); }
            _wbSetStatus('工作台状态：步骤 ' + (i + 1) + ' 异常 - ' + e.message, 'err');
            return;
        }
    }

    // 全部完成
    _wbExecState = 'done';
    var doneBtn = document.getElementById('wbExecuteBtn');
    if (doneBtn) { doneBtn.textContent = '全部执行'; doneBtn.classList.add('warn'); doneBtn.classList.remove('secondary'); }
    if (progressEl) {
        var pb2 = progressEl.querySelector('.module-progress-bar');
        var pt2 = progressEl.querySelector('.module-progress-text');
        if (pb2) pb2.style.width = '100%';
        if (pt2) pt2.textContent = '100%';
    }
    _wbShowOutput('✓ 全部完成（共 ' + _wbSteps.length + ' 步）');
    _wbSetStatus('工作台状态：全部完成 ✓', 'ok');
}

// 模拟执行
async function _wbSimulate() {
    if (!_wbSteps.length) {
        _wbSetStatus('工作台状态：步骤列表为空', 'warn');
        return;
    }
    _wbClearOutput();
    _wbShowOutput('===== 模拟执行（不实际调用 fastboot）=====');
    _wbShowOutput('共 ' + _wbSteps.length + ' 步');
    _wbSetStatus('工作台状态：模拟执行中...', 'info');

    for (var i = 0; i < _wbSteps.length; i++) {
        var s = _wbSteps[i];
        var args = (s.raw || '').split(/\s+/).filter(Boolean);
        _wbShowOutput('▶ [步骤 ' + (i + 1) + '/' + _wbSteps.length + '] fastboot ' + args.join(' '));

        // 检查步骤是否有效
        var issues = [];
        if (s.type === 'flash' || s.type === 'flash-args-front' || s.type === 'flash-args-back' || s.type === 'flash-dir') {
            if (!s.partition) issues.push('分区名缺失');
            if (!s.image) issues.push('镜像路径缺失');
        }
        if (s.type === 'cow' && !s.partition) issues.push('分区名缺失');
        if (s.type === 'custom' && !s.raw) issues.push('命令为空');

        if (issues.length) {
            _wbShowOutput('  ⚠ 检查发现问题: ' + issues.join(', '));
        } else {
            _wbShowOutput('  ✓ 检查通过');
        }

        // 模拟延迟
        await new Promise(function(r) { setTimeout(r, 200); });
    }

    _wbShowOutput('===== 模拟执行完成 =====');
    _wbSetStatus('工作台状态：模拟执行完成（检查通过 ' + _wbSteps.length + ' 步）', 'ok');
}

// 清空步骤
function _wbClearSteps() {
    if (!_wbSteps.length) return;
    if (typeof showConfirm === 'function') {
        showConfirm('确认', '确认清空所有步骤？此操作不可撤销。', function() {
            _wbSteps = [];
            _wbRenderSteps();
            _wbAutoSave();
            _wbClearOutput();
            _wbSetStatus('工作台状态：步骤已清空', 'ok');
        }, true);
    } else {
        if (confirm('确认清空所有步骤？')) {
            _wbSteps = [];
            _wbRenderSteps();
            _wbAutoSave();
            _wbClearOutput();
            _wbSetStatus('工作台状态：步骤已清空', 'ok');
        }
    }
}

// ===== 事件处理 =====

function _wbHandleClick(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    switch(action) {
        case 'wb-toggle-edit':
            e.preventDefault();
            _wbToggleEdit();
            break;
        case 'wb-import-config':
            e.preventDefault();
            _wbImportConfig();
            break;
        case 'wb-export-config':
            e.preventDefault();
            _wbExportConfig();
            break;
        case 'wb-delete-config':
            e.preventDefault();
            if (!_wbCurrentConfig) {
                _wbSetStatus('工作台状态：请先选择要删除的配置', 'warn');
                return;
            }
            if (typeof showConfirm === 'function') {
                showConfirm('确认删除', '确认删除配置「' + _wbCurrentConfig + '」？此操作不可撤销。', function() {
                    _wbDeleteConfig(_wbCurrentConfig);
                }, true);
            } else if (confirm('确认删除配置「' + _wbCurrentConfig + '」？')) {
                _wbDeleteConfig(_wbCurrentConfig);
            }
            break;
        case 'wb-show-add-step-dialog':
            e.preventDefault();
            _wbShowAddStepDialog();
            break;
        case 'wb-close-add-step-dialog':
            e.preventDefault();
            _wbCloseAddStepDialog();
            break;
        case 'wb-back-to-cards':
            e.preventDefault();
            _wbBackToCards();
            break;
        case 'wb-add-step-confirm':
            e.preventDefault();
            _wbAddStepConfirm();
            break;
        case 'wb-pick-image':
            e.preventDefault();
            _wbPickImage();
            break;
        case 'wb-pick-dir':
            e.preventDefault();
            _wbPickDir();
            break;
        case 'wb-show-fastboot-dialog':
            e.preventDefault();
            _wbShowFastbootDialog();
            break;
        case 'wb-close-fastboot-dialog':
            e.preventDefault();
            _wbCloseFastbootDialog();
            break;
        case 'wb-add-quick-step':
            e.preventDefault();
            _wbAddQuickStep(btn.dataset.cmd, btn.dataset.label);
            break;
        case 'wb-execute-all':
            e.preventDefault();
            _wbExecuteAll();
            break;
        case 'wb-simulate':
            e.preventDefault();
            _wbSimulate();
            break;
        case 'wb-clear-steps':
            e.preventDefault();
            _wbClearSteps();
            break;
    }
}

// 处理步骤卡片点击
function _wbHandleStepCardClick(e) {
    var card = e.target.closest('.wb-step-card');
    if (!card) return;
    var type = card.dataset.stepType;
    if (type) _wbSelectStepType(type);
}

// 处理 AB 勾选提示
function _wbHandleABChange(e) {
    if (e.target.id === 'wbFormAB') {
        var hint = document.getElementById('wbABHint');
        if (hint) hint.style.display = e.target.checked ? 'block' : 'none';
    }
}

// ===== 模块初始化 =====
Modules.register('workbench', ['api','utils','file-api'], function initWorkbenchModule() {
    // 主事件委托（工作台视图内）
    var workbenchView = document.querySelector('.app-view[data-view="workbench"]');
    if (workbenchView) workbenchView.addEventListener('click', _wbHandleClick);

    // 添加步骤弹窗事件（弹窗在 view 外，需单独绑定 data-action 委托）
    var addStepDialog = document.getElementById('wbAddStepDialog');
    if (addStepDialog) {
        addStepDialog.addEventListener('click', function(e) {
            // 先处理 data-action 按钮（返回/确认/取消/关闭/选文件）
            var actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                _wbHandleClick(e);
                return;
            }
            // 点击遮罩关闭
            if (e.target === addStepDialog) _wbCloseAddStepDialog();
            // 卡片选择
            var card = e.target.closest('.wb-step-card');
            if (card) _wbSelectStepType(card.dataset.stepType);
        });
        addStepDialog.addEventListener('change', _wbHandleABChange);
    }

    // Fastboot 弹窗事件（弹窗在 view 外，需单独绑定 data-action 委托）
    var fastbootDialog = document.getElementById('wbFastbootDialog');
    if (fastbootDialog) {
        fastbootDialog.addEventListener('click', function(e) {
            // 先处理 data-action 按钮（关闭/添加快捷命令）
            var actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                _wbHandleClick(e);
                return;
            }
            // 点击遮罩关闭
            if (e.target === fastbootDialog) _wbCloseFastbootDialog();
        });
    }

    // 配置下拉框事件（非编辑模式下选择配置）
    var configSelect = document.getElementById('wbConfigSelect');
    if (configSelect) {
        configSelect.addEventListener('change', _wbOnSelectChange);
    }
    // 编辑模式下 input 的 Enter 键确认
    var configInput = document.getElementById('wbConfigInput');
    if (configInput) {
        configInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && _wbEditMode) {
                e.preventDefault();
                _wbToggleEdit(); // 触发确认保存
            }
        });
    }

    // 加载配置列表
    _wbLoadConfigs();

    console.log('[workbench] 工作台模块已初始化（v4.0.0 重构版）');
    return true;
});
