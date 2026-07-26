// flash_tool/static/js/device.js
// ============ 环境检查（WebUSB 模式） ============
async function checkEnv() {
    envStatusBaseClass = 'env-status';
    envStatusBaseText = 'WebUSB 模式';
}

// ============ 设备槽位 ============
async function loadDeviceSlot() {
    try {
        let res = null;
        if (webusbFastbootReady && webusbFastboot) {
            const out = await webusbFastboot.command('getvar:current-slot');
            const raw = formatCommandResult(out);
            const m = raw.match(/current-slot\s*:\s*([ab])|^([ab])$/i);
            res = m ? {success: true, ab_device: true, slot: (m[1] || m[2]).toLowerCase()} : {success: true, ab_device: false, slot: ''};
        } else {
            res = {success: true, ab_device: false, slot: ''};
        }
        if (res.success && res.ab_device) {
            App.set('isAbDevice', true);
            App.set('currentSlot', res.slot);
            writeLog(`AB分区设备，当前槽位：${res.slot.toUpperCase()}`, 'ok');
        } else {
            App.set('isAbDevice', false);
            writeLog('非AB分区设备', 'tip');
        }
    } catch(e) {
        writeLog('槽位检测失败：' + e.message, 'err');
    }
}

// 注：formatPartition 已移至 utils.js（通用辅助函数）

// ============ 设备检测 ============


// ============ BL锁状态解析 ============
function formatBlStatus(value) {
    const raw = String(value || '').trim();
    const v = raw.toLowerCase();
    const m = v.match(/(?:unlocked|device unlocked)\s*[:=]\s*(yes|no|true|false|1|0)/);
    const normalized = m ? m[1] : v;
    if (['yes', 'true', '1', 'unlocked'].includes(normalized)) {
        return 'Bootloader状态：已解锁';
    }
    if (['no', 'false', '0', 'locked'].includes(normalized)) {
        return 'Bootloader状态：未解锁';
    }
    return 'Bootloader状态：未能明确判断';
}

function applyBlStatusFromText(raw) {
    const status = formatBlStatus(raw);
    App.set('blStatusText', status);
    App.set('blUnlocked', status.includes('已解锁') ? true : (status.includes('未解锁') ? false : null));
    return status;
}

async function refreshBlStatusAuto() {
    try {
        if (!webusbFastbootReady) {
            App.set('blUnlocked', null);
            App.set('blStatusText', 'Bootloader状态：未查询');
            return;
        }
        let raw = '';
        if (webusbFastbootReady && webusbFastboot) {
            const out = await webusbFastboot.command('getvar:unlocked');
            raw = formatCommandResult(out);
        }
        if (!raw || formatBlStatus(raw).includes('未能明确判断')) {
            try {
                if (webusbFastbootReady && webusbFastboot) {
                    const fallback = await webusbFastboot.command('getvar:unlocked').then(formatCommandResult);
                    if (fallback) raw = fallback;
                }
            } catch(e) {}
        }
        const status = applyBlStatusFromText(raw);
        writeLog(`自动查询Bootloader：${status}`, status.includes('已解锁') ? 'ok' : 'tip');
    } catch(e) {
        App.set('blUnlocked', null);
        App.set('blStatusText', 'Bootloader状态：未能明确判断');
        writeLog('自动查询Bootloader失败：' + e.message, 'tip');
    }
}

async function refreshDeviceInfoAuto() {
    try {
        if (!webusbFastbootReady) {
            App.set('deviceInfo', {});
            return;
        }
        let info = {};
        if (webusbFastbootReady && webusbFastboot) {
            const vars = ['product','product-name','variant','current-slot','serialno','is-userspace','battery-soc','battery-voltage'];
            for (const v of vars) {
                try {
                    const out = await webusbFastboot.command('getvar:' + v);
                    const raw = formatCommandResult(out);
                    const value = extractFastbootVar(raw, v);
                    if (value) info[v.replace(/-/g, '_').replace('serialno','serial')] = value;
                } catch(e) {}
            }
            if (info.product) info.product_display = info.product;
            else if (info.product_name) info.product_display = info.product_name;
        }
        App.set('deviceInfo', info);
        if (info.current_slot) {
            App.set('currentSlot', String(info.current_slot).replace(/^_/, '').toLowerCase());
            App.set('isAbDevice', true);
        }
    } catch(e) {
        writeLog('自动读取设备信息失败：' + e.message, 'tip');
    }
}

// ============ BL锁 ============
// ============ 刷机历史 ============
async function loadFlashHistory() {
    const listEl = document.getElementById('flashHistoryList');
    if (!listEl) return;
    // WebUSB 模式不依赖后端，暂无刷机历史记录
    listEl.innerHTML = '<p class="tip">暂无刷机历史记录</p>';
}

// ============ 模块初始化 ============
Modules.register('device', ['ui'], function initDeviceModule() {
    $('loadHistoryBtn').onclick = loadFlashHistory;

    // 全局检测设备按钮（全局胶囊中）
    var checkGlobalBtn = document.getElementById('checkDeviceGlobalBtn');
    if (checkGlobalBtn) {
        checkGlobalBtn.onclick = async () => {
            checkGlobalBtn.disabled = true;
            checkGlobalBtn.textContent = '检测中...';
            try {
                await detectWebUsbDevice();
            } catch(e) { writeLog('检测失败：' + e.message, 'err'); }
            checkGlobalBtn.disabled = false;
            checkGlobalBtn.textContent = '检测设备';
        };
    }

    // ===== 全局目录权限按钮 =====
    var dirBtn = document.getElementById('dirAccessBtn');
    if (dirBtn) {
        // 初始检查权限状态
        _updateDirBtnState();

        dirBtn.onclick = async () => {
            if (!window.showDirectoryPicker) {
                if (typeof showToast === 'function') showToast('当前浏览器不支持目录访问 API，请使用 Chrome 132+');
                return;
            }
            // 优先尝试恢复已有句柄并升级权限（避免重复弹窗选择目录）
            try {
                if (typeof FileApi !== 'undefined' && FileApi.restoreWebusbRootHandle) {
                    var existingHandle = await FileApi.restoreWebusbRootHandle();
                    if (existingHandle) {
                        // 在用户手势中请求 readwrite 权限
                        var perm = await existingHandle.queryPermission({ mode: 'readwrite' });
                        if (perm !== 'granted') {
                            perm = await existingHandle.requestPermission({ mode: 'readwrite' });
                        }
                        if (perm === 'granted') {
                            writeLog('目录权限已恢复（读写）：' + existingHandle.name, 'ok');
                            if (typeof showToast === 'function') showToast('目录权限已恢复');
                            _updateDirBtnState();
                            return;
                        }
                        // 权限请求失败，继续走重新选择流程
                    }
                }
            } catch(e) {
                // 恢复失败，继续走重新选择流程
            }
            // 没有已有句柄或权限升级失败：重新选择目录
            try {
                writeLog('正在请求手机目录访问权限...', 'info');
                var rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                if (typeof FileApi !== 'undefined' && FileApi._storeRootHandle) {
                    await FileApi._storeRootHandle(rootHandle);
                }
                writeLog('目录权限已授权：' + rootHandle.name, 'ok');
                if (typeof showToast === 'function') showToast('目录权限已授权');
                _updateDirBtnState();
            } catch(e) {
                if (e.name === 'AbortError') {
                    writeLog('用户取消了目录选择', 'tip');
                } else {
                    writeLog('获取目录权限失败：' + e.message, 'err');
                    if (typeof showToast === 'function') showToast('获取目录权限失败：' + e.message);
                }
            }
        };
    }

    // 更新目录按钮状态（绿色/灰色）
    // 刷新后 read 权限可自动恢复，readwrite 需用户手势重新授权
    // 按钮状态以 read 权限为准（有 read 权限即显示绿色），readwrite 在需要写入时按需请求
    async function _updateDirBtnState() {
        var btn = document.getElementById('dirAccessBtn');
        if (!btn) return;
        try {
            var hasPermission = false;
            if (window.showDirectoryPicker && typeof FileApi !== 'undefined' && FileApi.restoreWebusbRootHandle) {
                var handle = await FileApi.restoreWebusbRootHandle();
                if (handle) {
                    // 优先检查 readwrite，其次检查 read
                    var permRW = await handle.queryPermission({ mode: 'readwrite' });
                    if (permRW === 'granted') {
                        hasPermission = true;
                    } else {
                        var permR = await handle.queryPermission({ mode: 'read' });
                        hasPermission = (permR === 'granted');
                    }
                }
            }
            if (hasPermission) {
                btn.classList.add('granted');
                btn.title = '目录权限已授权（点击可重新授权或升级写入权限）';
            } else {
                btn.classList.remove('granted');
                btn.title = '点击授权手机目录访问权限';
            }
        } catch(e) {
            btn.classList.remove('granted');
        }
    }
    // 暴露给全局，供文件选择时检查
    // _checkDirPermission 检查 read 权限（用于判断是否可读取文件）
    window._checkDirPermission = async function() {
        if (window.showDirectoryPicker && typeof FileApi !== 'undefined' && FileApi.restoreWebusbRootHandle) {
            var handle = await FileApi.restoreWebusbRootHandle();
            if (handle) {
                var perm = await handle.queryPermission({ mode: 'read' });
                return perm === 'granted';
            }
        }
        return false;
    };
    // _ensureDirWritePermission 在用户手势中调用，请求 readwrite 权限（用于写入配置文件）
    window._ensureDirWritePermission = async function() {
        if (window.showDirectoryPicker && typeof FileApi !== 'undefined' && FileApi.restoreWebusbRootHandle) {
            var handle = await FileApi.restoreWebusbRootHandle();
            if (handle) {
                var perm = await handle.queryPermission({ mode: 'readwrite' });
                if (perm === 'granted') return true;
                // 在用户手势中请求 readwrite 权限
                var reqPerm = await handle.requestPermission({ mode: 'readwrite' });
                if (reqPerm === 'granted') {
                    _updateDirBtnState();
                    return true;
                }
            }
        }
        return false;
    };
    window._updateDirBtnState = _updateDirBtnState;

    $('checkBlBtn').onclick = async () => {
        setModuleStatus('toolbox', '工具箱状态：正在查询 Bootloader 锁状态。', 'info');
        showModuleProgress('toolbox', '查询 Bootloader');
        if (webusbFastbootReady) {
            try {
                const out = await webusbFastboot.command('getvar:unlocked');
                updateModuleProgress('toolbox', 100, '查询完成');
                const raw = formatCommandResult(out);
                const statusText = applyBlStatusFromText(raw);
                setModuleStatus('toolbox', `工具箱状态：WebUSB Bootloader锁状态查询完成。${statusText}。`, 'ok');
                writeLog(`WebUSB Bootloader锁查询结果：${statusText}（原始值：${raw || '空'}）`, 'ok');
            } catch(e) {
                App.set('blUnlocked', null);
                App.set('blStatusText', 'Bootloader状态：未能明确判断');
                setModuleStatus('toolbox', '工具箱状态：WebUSB Bootloader查询失败：' + e.message, 'err');
            }
            return;
        }
        App.set('blUnlocked', null);
        App.set('blStatusText', 'Bootloader状态：未查询');
        setModuleStatus('toolbox', '工具箱状态：Fastboot设备未连接，请先在顶部胶囊点击设备检测连接。', 'err');
    };

    $('unlockBlBtn').onclick = () => {
        showConfirm('解锁确认', '解锁Bootloader会清空设备所有数据，确认继续？', async () => {
            setModuleStatus('toolbox', '工具箱状态：正在发送解锁 Bootloader 指令。', 'warn');
            showModuleProgress('toolbox', '解锁 Bootloader');
            const res = (webusbFastbootReady)
                ? await webusbFastboot.command('oem unlock').then(() => ({success: true}))
                : {success: false, error: 'Fastboot设备未连接，请先在顶部胶囊点击设备检测连接'};
            updateModuleProgress('toolbox', 100, '命令完成');
            setModuleStatus('toolbox', res.success ? '工具箱状态：已发送解锁 Bootloader 指令。' : `工具箱状态：解锁 Bootloader 失败：${res.error}`, res.success ? 'ok' : 'err');
            res.success ? writeLog('解锁指令已发送', 'ok') : writeLog(res.error, 'err');
            if (res.success) {
                App.set('blUnlocked', null);
                App.set('blStatusText', 'Bootloader状态：未查询');
            }
        });
    };

    $('lockBlBtn').onclick = () => {
        showConfirm('上锁确认', '上锁Bootloader会清空所有数据，请确保已刷入官方系统，确认继续？', async () => {
            setModuleStatus('toolbox', '工具箱状态：正在发送上锁 Bootloader 指令。', 'warn');
            showModuleProgress('toolbox', '上锁 Bootloader');
            const res = (webusbFastbootReady)
                ? await webusbFastboot.command('oem lock').then(() => ({success: true}))
                : {success: false, error: 'Fastboot设备未连接，请先在顶部胶囊点击设备检测连接'};
            updateModuleProgress('toolbox', 100, '命令完成');
            setModuleStatus('toolbox', res.success ? '工具箱状态：已发送上锁 Bootloader 指令。' : `工具箱状态：上锁 Bootloader 失败：${res.error}`, res.success ? 'ok' : 'err');
            res.success ? writeLog('上锁指令已发送', 'ok') : writeLog(res.error, 'err');
            if (res.success) {
                App.set('blUnlocked', null);
                App.set('blStatusText', 'Bootloader状态：未查询');
            }
        });
    };

    // ===== 自定义命令/脚本执行 =====
    function updateCustomCmdHint() {
        var hint = document.getElementById('customCmdModeHint');
        if (!hint) return;
        hint.textContent = 'WebUSB · 仅支持 fastboot/adb 命令';
        hint.style.color = 'var(--accent-orange,#ff9800)';
    }

    // ===== 会话工作目录管理（cd 命令持久化） =====
    // 生成或获取会话 ID（保存在 localStorage，同一浏览器标签页保持一致）
    function _getCustomCmdSessionId() {
        var key = 'custom_cmd_session_id';
        var sid = localStorage.getItem(key);
        if (!sid) {
            sid = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
            localStorage.setItem(key, sid);
        }
        return sid;
    }

    // 更新工作目录显示
    function _updateCustomCmdCwdDisplay(cwd) {
        var cwdEl = document.getElementById('customCmdCwd');
        if (!cwdEl) return;
        if (cwd) {
            var display = cwd;
            if (cwd.length > 45) {
                display = '...' + cwd.slice(-42);
            }
            cwdEl.textContent = display;
            cwdEl.title = cwd;
            cwdEl.style.display = '';
        } else {
            cwdEl.style.display = 'none';
        }
    }

    // 初始化时获取当前工作目录（WebUSB 模式无后端，留空）
    async function _initCustomCmdCwd() {
        // WebUSB 模式不依赖后端工作目录
    }

    // 解析命令，判断类型
    function _parseCmdType(cmd) {
        var trimmed = cmd.trim();
        var lower = trimmed.toLowerCase();
        if (lower.startsWith('fastboot ')) {
            return { type: 'fastboot', args: trimmed.slice(9).trim().split(/\s+/) };
        }
        if (lower === 'fastboot') {
            return { type: 'fastboot', args: [] };
        }
        if (lower.startsWith('adb ')) {
            return { type: 'adb', args: trimmed.slice(4).trim().split(/\s+/) };
        }
        if (lower === 'adb') {
            return { type: 'adb', args: [] };
        }
        return { type: 'shell', args: trimmed };
    }

    function _formatOutput(timestamp, cmd, success, output, extraInfo) {
        var html = '<span style="color:var(--text-muted);">[' + timestamp + '] 执行: ' + escHtml(cmd) + '</span>\n';
        if (success) {
            if (output) html += '<span style="color:var(--accent-green);">' + escHtml(output) + '</span>';
            else html += '<span style="color:var(--text-muted);">命令执行完成（无输出）</span>';
        } else {
            if (output) html += '<span style="color:var(--accent-orange,#ff9800);">' + escHtml(output) + '</span>';
            html += '\n<span style="color:var(--accent-red,#ef4444);">执行失败</span>';
        }
        if (extraInfo) html += '\n<span style="color:var(--text-muted);">' + escHtml(extraInfo) + '</span>';
        return html;
    }

    async function runCustomCmd() {
        var input = document.getElementById('customCmdInput');
        var output = document.getElementById('customCmdOutput');
        var btn = document.getElementById('customCmdRunBtn');
        if (!input || !output || !btn) return;

        var cmd = input.value.trim();
        if (!cmd) {
            output.innerHTML = '<span style="color:var(--accent-orange,#ff9800);">请输入命令</span>';
            return;
        }

        var parsed = _parseCmdType(cmd);
        var timestamp = new Date().toLocaleTimeString();
        btn.disabled = true;
        btn.textContent = '执行中...';
        output.innerHTML = '<span style="color:var(--text-muted);">[' + timestamp + '] 执行: ' + escHtml(cmd) + '</span>\n<span style="color:var(--text-muted);">执行中...</span>';

        try {
            // WebUSB 模式：只支持 fastboot/adb 纯命令
            if (parsed.type === 'fastboot') {
                // WebUSB 模式：flash 命令通过文件选择器获取镜像
                if (parsed.args[0] === 'flash') {
                    if (!webusbFastbootReady || !webusbFastboot) {
                        output.innerHTML = '<span style="color:var(--text-muted);">[' + timestamp + '] 执行: ' + escHtml(cmd) + '</span>\n' +
                            '<span style="color:var(--accent-red,#ef4444);">⚠️ Fastboot设备未连接，请先在顶部胶囊点击设备检测连接。</span>';
                    } else {
                        // 通过文件选择器获取镜像文件
                        try {
                            var pickedFile = await FileApi.pickFile({ filter: '.img,.bin,.elf', pathOnly: true });
                            if (pickedFile && pickedFile.file) {
                                output.innerHTML = '<span style="color:var(--text-muted);">[' + timestamp + '] 执行: ' + escHtml(cmd) + '</span>\n' +
                                    '<span style="color:var(--text-muted);">正在刷写 ' + pickedFile.name + '...</span>';
                                var flashPartition = parsed.args[1];
                                await runWebUsbFastbootCommand({ command: 'flash', partition: flashPartition, payload: pickedFile.file });
                                output.innerHTML = _formatOutput(timestamp, cmd, true, '已刷写 ' + flashPartition + ' (' + pickedFile.name + ')');
                            }
                        } catch(e) {
                            if (e.message && e.message.indexOf('取消') >= 0) {
                                output.innerHTML = '<span style="color:var(--text-muted);">[' + timestamp + '] 执行: ' + escHtml(cmd) + '</span>\n<span style="color:var(--text-muted);">已取消选择文件</span>';
                            } else {
                                output.innerHTML = _formatOutput(timestamp, cmd, false, '刷写失败: ' + e.message);
                            }
                        }
                    }
                } else if (!webusbFastbootReady || !webusbFastboot) {
                    output.innerHTML = '<span style="color:var(--text-muted);">[' + timestamp + '] 执行: ' + escHtml(cmd) + '</span>\n' +
                        '<span style="color:var(--accent-red,#ef4444);">⚠️ Fastboot设备未连接，请先在顶部胶囊点击设备检测连接。</span>';
                } else {
                    var fbResult = await webusbFastboot.fastbootCommand(parsed.args.join(' '));
                    output.innerHTML = _formatOutput(timestamp, cmd, true, String(fbResult || 'OKAY'));
                }
            } else if (parsed.type === 'adb') {
                if (!webusbAdbReady || !webusbAdb) {
                    output.innerHTML = '<span style="color:var(--text-muted);">[' + timestamp + '] 执行: ' + escHtml(cmd) + '</span>\n' +
                        '<span style="color:var(--accent-red,#ef4444);">⚠️ ADB设备未连接，请先在顶部胶囊点击设备检测连接。</span>';
                } else {
                    var adbResult = await webusbAdb.adbCommand(parsed.args.join(' '));
                    output.innerHTML = _formatOutput(timestamp, cmd, true, String(adbResult || ''));
                }
            } else {
                // 非 fastboot/adb 命令，WebUSB 不支持
                output.innerHTML = '<span style="color:var(--text-muted);">[' + timestamp + '] 执行: ' + escHtml(cmd) + '</span>\n' +
                    '<span style="color:var(--accent-orange,#ff9800);">⚠️ WebUSB 模式仅支持 fastboot 和 adb 纯命令。\n\n' +
                    'WebUSB 模式可执行的命令：\n' +
                    '• fastboot getvar all\n' +
                    '• fastboot erase userdata\n' +
                    '• adb shell ls /sdcard\n' +
                    '• adb reboot recovery</span>';
            }
            output.scrollTop = output.scrollHeight;
        } catch(e) {
            output.innerHTML = '<span style="color:var(--text-muted);">[' + timestamp + '] 执行: ' + escHtml(cmd) + '</span>\n<span style="color:var(--accent-red,#ef4444);">执行异常: ' + escHtml(e.message) + '</span>';
        }

        btn.disabled = false;
        btn.textContent = '执行';
    }

    if ($('customCmdRunBtn')) {
        $('customCmdRunBtn').onclick = runCustomCmd;
    }
    if ($('customCmdInput')) {
        $('customCmdInput').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                runCustomCmd();
            }
        });
    }
    updateCustomCmdHint();
    // 定期更新模式提示
    setInterval(updateCustomCmdHint, 2000);
    // 初始化工作目录显示
    _initCustomCmdCwd();

    // ===== WebUSB 设备断开实时检测 =====
    if (navigator.usb) {
        navigator.usb.addEventListener('disconnect', function(e) {
            console.log('[webusb] 设备断开:', e.device);
            webusbFastbootReady = false;
            webusbAdbReady = false;
            canFastboot = false;
            canAdb = false;
            deviceMode = '';
            if (typeof webusbFastboot !== 'undefined') webusbFastboot = null;
            if (typeof webusbAdb !== 'undefined') webusbAdb = null;
            if (typeof selectedUsbDevice !== 'undefined') selectedUsbDevice = null;
            if (typeof writeLog === 'function') writeLog('WebUSB 设备已断开连接', 'warn');
            if (typeof updateBtnState === 'function') updateBtnState();
            if (typeof updateSmartUI === 'function') updateSmartUI();
            if (typeof showToast === 'function') showToast('设备已断开连接');
        });
        // 也监听 connect 事件
        navigator.usb.addEventListener('connect', function(e) {
            console.log('[webusb] 设备连接:', e.device);
            if (typeof writeLog === 'function') writeLog('检测到 USB 设备连接，请点击「检测设备」', 'info');
        });
    }

    console.log('[device] WebUSB 设备模块已初始化');
    return true;
});

// ============ 错误诊断卡片 ============
function showErrorCard(error, diagnosis) {
    const target = getLogBoxForView();
    const card = document.createElement('div');
    card.className = 'error-card';
    card.innerHTML = `
        <div class="error-title">❌ ${escHtml(error)}</div>
        <div class="diagnosis-box">
            <strong>💡 解决建议：</strong>
            <p>${escHtml(diagnosis) || '暂无建议'}</p>
        </div>
    `;
    target.appendChild(card);
    target.scrollTop = target.scrollHeight;
}

async function diagnoseFastbootError(errorText) {
    const e = String(errorText || '').toLowerCase();
    if (!e) return '';
    // 本地简单匹配（5 种常见模式）
    if (e.includes('partition flashing is not allowed') || e.includes('not allowed in locked state')) {
        return '可能原因：Bootloader 未解锁或当前分区禁止刷写。建议先查询 Bootloader 状态，确认已解锁后再刷写。';
    }
    if (e.includes('no such partition') || e.includes('unknown partition')) {
        return '可能原因：分区名不适用于当前机型。建议确认刷机包与设备型号匹配，或检查脚本中的分区名。';
    }
    if (e.includes('sparse') || e.includes('size too large') || e.includes('overflow')) {
        return '可能原因：镜像过大或分区表不匹配。建议确认线刷包是否匹配当前机型。';
    }
    if (e.includes('unknown command')) {
        return '可能原因：当前设备或 Fastboot 版本不支持该命令。建议换用通用 getvar/flashing 命令或切换连接模式。';
    }
    if (e.includes('no devices') || e.includes('device not found') || e.includes('timeout')) {
        return '可能原因：设备断开或未处于 Fastboot/ADB 状态。建议重新检测设备，必要时重新插拔 USB。';
    }
    return '';
}

function showFlashReport(success, detail = '') {
    const done = stepList.length;
    const mode = 'WebUSB Fastboot';
    const slot = currentSlot ? currentSlot.toUpperCase() : '未知';
    const title = success ? '线刷报告：成功' : '线刷报告：失败/中断';
    const report = `${title}\n时间：${new Date().toLocaleString()}\n模式：${mode}\nBootloader：${blStatusText}\n槽位：${slot}\n步骤：${done}\n${detail || ''}`;
    const card = document.getElementById('flashReportCard');
    if (card) {
        const product = getDeviceProduct();
        const script = document.getElementById('batSelect') ? (document.getElementById('batSelect').value || '未选择') : '未知';
        card.className = `report-card ${success ? 'ok' : 'err'}`;
        card.style.display = 'block';
        card.innerHTML = `
            <h4>${title}</h4>
            <div class="report-grid">
                <div class="report-metric"><span>结果</span>${success ? '成功' : '失败/中断'}</div>
                <div class="report-metric"><span>步骤</span>${done}</div>
                <div class="report-metric"><span>模式</span>${mode}</div>
                <div class="report-metric"><span>设备代号</span>${product}</div>
                <div class="report-metric"><span>槽位</span>${slot}</div>
                <div class="report-metric"><span>Bootloader</span>${blStatusText.replace('Bootloader状态：','')}</div>
            </div>
            <div class="report-detail">脚本：${escHtml(script)}\n时间：${new Date().toLocaleString()}\n${escHtml(detail) || ''}</div>
        `;
    }
    writeLog(report, success ? 'ok' : 'err');
}
