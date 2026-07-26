// flash_tool/static/js/flash.js
// ============ 线刷（WebUSB 模式） ============
async function startBatchFlash() {
    if (stepList.length === 0) {
        setModuleStatus('batch', '线刷状态：请先解析刷机脚本。', 'err');
        writeLog('请先解析刷机脚本', 'err');
        return;
    }
    if (blUnlocked === false) {
        setModuleStatus('batch', '线刷状态：Bootloader 未解锁，已阻止线刷。请先解锁 Bootloader 后再刷写。', 'err');
        writeLog('Bootloader 未解锁，已阻止线刷', 'err');
        showErrorCard('Bootloader 未解锁', '大多数分区在线刷前必须先解锁 Bootloader。请到工具页执行"查询锁状态/解锁Bootloader"，确认已解锁后再线刷。');
        return;
    }

    // WebUSB 模式：通过 batch-new.js 的执行按钮触发线刷
    const newExecuteBtn = document.getElementById('newExecuteBtn');
    if (newExecuteBtn) {
        newExecuteBtn.click();
    }
}

// ============ 补充函数 ============
function updateDeviceInfoSummary() {
    const el = document.getElementById('deviceInfoSummary');
    if (!el) return;
    const fastbootReady = canFastboot || webusbFastbootReady;
    if (!fastbootReady) {
        el.innerHTML = '<span class="muted">未连接 Fastboot 设备</span>';
        return;
    }
    const product = getDeviceProduct();
    const slot = currentSlot ? currentSlot.toUpperCase() : '未知';
    const userspace = String(deviceInfo.is_userspace || deviceInfo['is-userspace'] || '').trim().toLowerCase();
    const mode = userspace === 'yes' || userspace === 'true' || userspace === '1' ? 'Fastbootd' : getFastbootModeLabel();
    const battery = normalizeBatterySoc(deviceInfo.battery_soc || deviceInfo.battery);
    const voltage = normalizeVoltage(deviceInfo.battery_voltage);
    const bl = blStatusText.replace('Bootloader状态：', '') || '未查询';
    el.innerHTML = `
        <div class="info-grid">
            <div><span class="label">设备代号</span><span class="value">${escHtml(product)}</span></div>
            <div><span class="label">当前模式</span><span class="value">${escHtml(mode)}</span></div>
            <div><span class="label">当前槽位</span><span class="value">${slot}</span></div>
            <div><span class="label">电池</span><span class="value">${battery} / ${voltage}</span></div>
            <div><span class="label">Bootloader</span><span class="value">${escHtml(bl)}</span></div>
            <div><span class="label">序列号</span><span class="value">${escHtml(cleanFastbootVarValue(deviceInfo.serial) || '未知')}</span></div>
        </div>`;
}

async function runCustomFastbootCommand() {
    const tool = document.getElementById('commandTool').value || 'fastboot';
    let rawCmd = document.getElementById('customFastbootCmd').value || '';
    if (!rawCmd.trim()) {
        setModuleStatus('command', '命令状态：请输入要执行的命令。', 'warn');
        return;
    }
    const args = parseFastbootArgs(rawCmd);
    setModuleStatus('command', `命令状态：正在执行 ${tool} ${rawCmd}…`, 'info');
    showModuleProgress('command', `执行 ${tool} ${args.join(' ')}`);
    try {
        let resultText = '';
        // WebUSB 模式：只保留 WebUSB 路径
        if (!webusbFastbootReady) {
            throw new Error('Fastboot设备未连接，请先在顶部胶囊点击设备检测连接');
        }
        const cmdObj = fastbootArgsToWebUsbCommand(args);
        if (cmdObj) {
            resultText = await runWebUsbFastbootCommand(cmdObj);
        } else {
            throw new Error('WebUSB 模式暂不支持该命令');
        }
        const localized = localizeFastbootResult(tool, args, resultText);
        writeLog(`命令返回：${localized}`, 'ok');
        setModuleStatus('command', '命令状态：执行完成。', 'ok');
        document.getElementById('customFastbootResult').textContent = localized;
    } catch(e) {
        const msg = await diagnoseFastbootError(e.message);
        writeLog(`命令失败：${msg}`, 'err');
        setModuleStatus('command', `命令状态：${msg}`, 'err');
        document.getElementById('customFastbootResult').textContent = msg;
    } finally {
        hideModuleProgress('command');
    }
}

// ============ 模块初始化 ============
Modules.register('flash', ['api','utils','bat','bat-risk'], function initFlashModule() {
    const batchBtn = document.getElementById('batchFlashBtn');
    if (batchBtn) batchBtn.onclick = startBatchFlash;

    console.log('[flash] 线刷模块已初始化（WebUSB）');
    return true;
});
