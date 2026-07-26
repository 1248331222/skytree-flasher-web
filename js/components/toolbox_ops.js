// flash_tool/static/js/toolbox_ops.js

// ============ 重启 ============
const rebootSysTask = new ModuleTask('工具箱', '重启系统');
function rebootSys() {
    showConfirm('确认', '确认重启设备到系统？', async () => {
        rebootSysTask.status('正在重启到系统。', 'warn');
        await sendRebootCommand('');
        rebootSysTask.status('已发送重启到系统指令。', 'ok');
        rebootSysTask.log('已发送重启指令', 'ok');
    }, true, 0);
}

function rebootRec() {
    showConfirm('确认', '确认重启到Recovery？', async () => {
        setModuleStatus('toolbox', '工具箱状态：正在重启到 Recovery。', 'warn');
        showModuleProgress('toolbox', '重启 Recovery');
        updateModuleProgress('toolbox', 50, '已发送重启命令');
        await sendRebootCommand('recovery');
        updateModuleProgress('toolbox', 100, '命令已发送');
        setModuleStatus('toolbox', '工具箱状态：已发送重启到 Recovery 指令。', 'ok');
        writeLog('已发送重启到REC指令', 'ok');
    }, false, 0);
}

function rebootFb() {
    showConfirm('确认', '确认重启到Fastboot？', async () => {
        setModuleStatus('toolbox', '工具箱状态：正在重启到 Fastboot/Bootloader。', 'warn');
        showModuleProgress('toolbox', '重启 Fastboot');
        await sendRebootCommand('fastboot');
        writeLog('已发送重启到Fastboot指令', 'ok');
        // sendRebootCommand 内部已包含 waitForReconnectAfterReconnect，无需重复等待
    }, false, 0);
}

function rebootBootloader() {
    showConfirm('确认', '确认重启到Bootloader？Bootloader 模式下才能执行 fastboot 刷写、解锁、切槽等操作。', async () => {
        setModuleStatus('toolbox', '工具箱状态：正在重启到 Bootloader。', 'warn');
        showModuleProgress('toolbox', '重启 Bootloader');
        await sendRebootCommand('bootloader');
        writeLog('已发送重启到Bootloader指令', 'ok');
        // sendRebootCommand 内部已包含 waitForReconnectAfterReconnect，无需重复等待
    }, false, 0);
}

async function readDeviceInfo() {
    try {
        setModuleStatus('toolbox', '工具箱状态：正在读取设备信息。', 'info');
        showModuleProgress('toolbox', '读取设备信息');
        updateModuleProgress('toolbox', 50, '查询中');
        if (!webusbFastbootReady) {
            hideModuleProgress('toolbox');
            setModuleStatus('toolbox', '工具箱状态：Fastboot设备未连接，请先在顶部胶囊点击设备检测连接。', 'err');
            writeLog('Fastboot设备未连接，无法读取设备信息', 'err');
            return;
        }
        await refreshDeviceInfoAuto();
        updateModuleProgress('toolbox', 100, '读取完成');
        deviceInfo = (typeof deviceInfo !== 'undefined') ? deviceInfo : {};
        if (deviceInfo.current_slot) {
            currentSlot = String(deviceInfo.current_slot).replace(/^_/, '').toLowerCase();
            updateToolCurrentSlotBadge();
        }
        updateDeviceInfoSummary();
        updateSmartUI();
        setModuleStatus('toolbox', '工具箱状态：设备信息读取完成。', 'ok');
        writeDeviceInfoHumanLog(deviceInfo);
        writeLog('完整设备信息已读取完成。', 'tip');
    } catch(e) {
        hideModuleProgress('toolbox');
        setModuleStatus('toolbox', `工具箱状态：读取设备信息异常：${e.message}`, 'err');
        writeLog('读取设备信息异常：' + e.message, 'err');
    }
}

// ============ 切槽位 ============
const switchSlotTask = new ModuleTask('工具箱', '切槽');
function switchSlot() {
    const slot = document.getElementById('slotSelect').value;
    switchSlotTask.confirm('确认', `切换到 ${slot.toUpperCase()} 槽？`, async () => {
        switchSlotTask.status(`正在切换到 ${slot.toUpperCase()} 槽。`, 'warn');
        switchSlotTask.showProgress('切换槽位');
        switchSlotTask.updateProgress(50, '命令已发送');
        if (webusbFastbootReady) {
            await webusbFastboot.command(`set_active:${slot}`);
        } else {
            throw new Error('WebUSB Fastboot 未连接');
        }
        switchSlotTask.updateProgress(100, '切换完成');
        switchSlotTask.status(`已切换到 ${slot.toUpperCase()} 槽。`, 'ok');
        switchSlotTask.log(`已切换到${slot}槽`, 'ok');
        await loadDeviceSlot();
    });
}

// ============ 双清 ============
async function webusbEraseWithFallback(part) {
    // 在新机型上 userdata/cache 多为动态分区，需要 fastbootd（reboot fastboot）。
    // 这里依次尝试：part、part_a、part_b，把 "doesn't exist" 视为该候选不存在。
    const candidates = [part, part + '_a', part + '_b'];
    let lastErr = null;
    let ok = false;
    for (const name of candidates) {
        try {
            await webusbFastboot.command('erase:' + name);
            writeLog(`WebUSB 已擦除分区：${name}`, 'ok');
            ok = true;
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            lastErr = msg;
            // 分区不存在：跳过尝试下一个候选
            if (/doesn'?t exist|partition does not exist|not found/i.test(msg)) {
                writeLog(`WebUSB 分区不存在，跳过：${name}`, 'tip');
                continue;
            }
            // 其它错误：直接抛出
            throw e;
        }
    }
    if (!ok) {
        // 全部候选都不存在：给出明确提示
        throw new Error(`未找到 ${part} 分区。如设备处于 Bootloader Fastboot，请先进入 fastbootd（adb reboot fastboot 或 fastboot reboot fastboot）后重试。原始信息：${lastErr || ''}`);
    }
}

const wipeTask = new ModuleTask('工具箱', '双清');
function wipeData() {
    wipeTask.confirm('高危操作确认',
        '双清会清除所有数据（照片、应用、文件），完全不可恢复，确认继续？',
        async () => {
            wipeTask.status('正在执行双清 userdata/cache。', 'warn');
            wipeTask.showProgress('双清中');
            wipeTask.log('开始双清');
            if (webusbFastbootReady) {
                await webusbEraseWithFallback('userdata');
            } else {
                throw new Error('WebUSB Fastboot 未连接');
            }
            wipeTask.updateProgress(50, 'userdata 已擦除');
            if (webusbFastbootReady) {
                // cache 在新机型上常常已被去除：缺失视为正常
                try {
                    await webusbEraseWithFallback('cache');
                } catch (eCache) {
                    const cmsg = (eCache && eCache.message) ? eCache.message : String(eCache);
                    if (/未找到 cache/.test(cmsg)) {
                        wipeTask.log('设备无 cache 分区，已忽略。', 'tip');
                    } else {
                        throw eCache;
                    }
                }
            }
            wipeTask.updateProgress(100, '双清完成');
            wipeTask.status('双清完成。', 'ok');
            wipeTask.log('双清完成', 'ok');
            showToast('双清操作完成');
        });
}

// ============ 擦除metadata ============
function wipeMetadata() {
    showConfirm('高危操作确认',
        '擦除 metadata 分区会清除设备加密状态、OEM Unlock 计数等信息。此操作不可恢复，确认继续？',
        async () => {
            setModuleStatus('toolbox', '工具箱状态：正在擦除 metadata 分区...', 'warn');
            showModuleProgress('toolbox', '擦除 metadata');
            writeLog('开始擦除 metadata');
            try {
                if (webusbFastbootReady) {
                    await webusbEraseWithFallback('metadata');
                } else {
                    throw new Error('WebUSB Fastboot 未连接');
                }
                updateModuleProgress('toolbox', 100, 'metadata 已擦除');
                setModuleStatus('toolbox', '工具箱状态：metadata 擦除完成。', 'ok');
                writeLog('metadata 擦除完成', 'ok');
                showToast('metadata 擦除完成');
            } catch(e) {
                hideModuleProgress('toolbox');
                setModuleStatus('toolbox', `工具箱状态：metadata 擦除失败：${e.message}`, 'err');
                writeLog('metadata 擦除失败：' + e.message, 'err');
            }
        });
}

async function sendRebootCommand(target) {
    const t = target || 'system';
    if (!canFastboot && !webusbFastbootReady && !canAdb && !webusbAdbReady) {
        showToast('请先检测设备');
        return false;
    }
    showModuleProgress('toolbox', `重启到 ${t}…`);
    try {
        if (webusbFastbootReady || webusbAdbReady) {
            // WebUSB 模式：runWebUsbFastbootCommand 内部已自动处理 fastboot/adb 设备选择
            // 对于 ADB 设备重启到 fastboot，target 应传 'bootloader'
            const webusbTarget = (webusbAdbReady && t === 'fastboot') ? 'bootloader' : t;
            await runWebUsbFastbootCommand({command: 'reboot', target: webusbTarget});
        } else {
            throw new Error('WebUSB 设备未连接');
        }
        writeLog(`已发送重启到 ${t} 指令`, 'ok');
        showToast(`已重启到 ${t}`);
        canFastboot = false;
        canAdb = false;
        deviceMode = '';
        updateBtnState();
        setModuleStatus('toolbox', `工具箱状态：已重启到 ${t}，等待设备重连...`, 'ok');

        // WebUSB 模式下需要重新枚举设备，提示用户重新检测
        writeLog('WebUSB 模式：请重新点击「检测设备」连接设备', 'warn');
        setModuleStatus('toolbox', '工具箱状态：WebUSB 模式，请重新检测设备', 'warn');
        return true;
    } catch(e) {
        writeLog('重启失败：' + e.message, 'err');
        setModuleStatus('toolbox', `工具箱状态：重启失败：${e.message}`, 'err');
        showToast('重启失败：' + e.message);
        return false;
    } finally {
        hideModuleProgress('toolbox');
    }
}

// 重启后等待设备重连
async function waitForReconnectAfterReboot(target) {
    const targetLabel = target === 'system' ? '系统' : (target === 'recovery' ? 'Recovery' : (target === 'fastboot' || target === 'bootloader' ? 'Fastboot' : target));
    writeLog(`等待设备重连到 ${targetLabel} 模式...`, 'info');
    setModuleStatus('toolbox', `工具箱状态：等待设备重连到 ${targetLabel}...`, 'info');

    // 等待 3 秒让设备离线
    await new Promise(r => setTimeout(r, 3000));

    const maxAttempts = 30; // 30 次 * 2 秒 = 60 秒
    for (let i = 0; i < maxAttempts; i++) {
        if (typeof writeLog === 'function' && i === 0) {
            writeLog(`开始检测设备重连（最多等待 60 秒）`, 'info');
        }
        try {
            // WebUSB 模式：通过 navigator.usb.getDevices() 检测已配对设备
            if (navigator.usb) {
                const devices = await navigator.usb.getDevices();
                for (const dev of devices) {
                    try {
                        if (dev.opened) await dev.close();
                        await dev.open();
                        const mode = detectDeviceMode(dev);

                        // 重启到 fastboot/bootloader 模式
                        if ((target === 'fastboot' || target === 'bootloader') && mode === 'fastboot') {
                            const ok = await claimWebUsbFastboot(dev);
                            if (ok) {
                                selectedUsbDevice = dev;
                                writeLog(`设备已重连到 Fastboot 模式`, 'ok');
                                setModuleStatus('toolbox', '工具箱状态：设备已重连到 Fastboot', 'ok');
                                canFastboot = true;
                                canAdb = false;
                                deviceMode = 'webusb-fastboot';
                                if (typeof updateBtnState === 'function') updateBtnState();
                                if (typeof refreshDeviceInfoAuto === 'function') {
                                    try { await refreshDeviceInfoAuto(); } catch(e) {}
                                }
                                return true;
                            }
                        }
                        // 重启到 recovery 模式（ADB 模式的一种）
                        if (target === 'recovery' && mode === 'adb') {
                            const ok = await claimWebUsbInterface(dev);
                            if (ok) {
                                selectedUsbDevice = dev;
                                writeLog(`设备已重连到 Recovery 模式`, 'ok');
                                setModuleStatus('toolbox', '工具箱状态：设备已重连到 Recovery', 'ok');
                                canFastboot = false;
                                canAdb = true;
                                deviceMode = 'webusb-adb';
                                if (typeof updateBtnState === 'function') updateBtnState();
                                return true;
                            }
                        }
                        // 重启到系统
                        if ((target === 'system' || target === '') && mode === 'adb') {
                            const ok = await claimWebUsbInterface(dev);
                            if (ok) {
                                selectedUsbDevice = dev;
                                writeLog(`设备已重连到系统`, 'ok');
                                setModuleStatus('toolbox', '工具箱状态：设备已重连到系统', 'ok');
                                canFastboot = false;
                                canAdb = true;
                                deviceMode = 'webusb-adb';
                                if (typeof updateBtnState === 'function') updateBtnState();
                                return true;
                            }
                        }
                        // 关闭未使用的设备
                        if (dev.opened) { try { await dev.close(); } catch(e) {} }
                    } catch(e) { /* 设备可能还未就绪，继续等待 */ }
                }
            }
        } catch(e) {
            // 忽略错误，继续等待
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    writeLog(`设备重连超时（60秒），请手动检测设备`, 'warn');
    setModuleStatus('toolbox', `工具箱状态：设备重连超时，请手动点击「检测设备」`, 'warn');
    if (typeof showToast === 'function') showToast('设备重连超时，请手动检测设备');
    return false;
}

// ============ 模块初始化 ============
Modules.register('toolbox-ops', ['api','utils','device-info'], function initToolboxOpsModule() {
    document.getElementById('rebootSysBtn').onclick = rebootSys;
    document.getElementById('rebootRecBtn').onclick = rebootRec;
    document.getElementById('rebootFbBtn').onclick = rebootFb;
    document.getElementById('rebootBootloaderBtn').onclick = rebootBootloader;
    document.getElementById('readDeviceInfoBtn').onclick = readDeviceInfo;
    document.getElementById('setSlotBtn').onclick = switchSlot;
    document.getElementById('wipeBtn').onclick = wipeData;
    document.getElementById('wipeMetadataBtn').onclick = wipeMetadata;

    console.log('[toolbox-ops] 工具箱操作模块已初始化');
    return true;
});
