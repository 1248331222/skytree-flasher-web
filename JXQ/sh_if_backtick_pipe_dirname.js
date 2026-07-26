// sh_if_dirname.js
// 规则：完整解析所有 fastboot/adb 命令，最后统一移除所有含 getvar 的步骤
export async function parse(content, ctx) {
    const steps = [];
    const romDir = ctx.romDir || '';

    // ---------- 路径拼接（防重复、防占位符污染） ----------
    function resolvePath(rawPath) {
        if (!rawPath) return rawPath;
        let p = rawPath.replace(/\\/g, '/').replace(/^["']|["']$/g, '');
        if (/\$[@*]|\$[1-9]/.test(p)) return p;
        if (!romDir) return p;
        const normRomDir = romDir.replace(/\/+$/, '') + '/';
        if (p.startsWith(normRomDir)) return p;
        if (p.startsWith('/')) return p;
        return normRomDir + p;
    }

    // ---------- 预处理：合并续行，去除注释 ----------
    const lines = content.split('\n');
    const mergedLines = [];
    let currentLine = '';
    for (let line of lines) {
        line = line.replace(/\r$/, '');
        if (line.endsWith('\\')) {
            currentLine += line.slice(0, -1) + ' ';
            continue;
        }
        currentLine += line;
        const commentIndex = currentLine.search(/(?<!\\)#/);
        if (commentIndex !== -1) currentLine = currentLine.substring(0, commentIndex);
        if (currentLine.trim() !== '') mergedLines.push(currentLine.trim());
        currentLine = '';
    }
    if (currentLine.trim() !== '') mergedLines.push(currentLine.trim());

    // ---------- 处理每一行 ----------
    for (let line of mergedLines) {
        let cmd = line;

        // 替换 $(dirname $0) / `dirname $0` 为 romDir
        if (romDir) {
            cmd = cmd.replace(/\$\(dirname\s+\$0\)/g, romDir);
            cmd = cmd.replace(/`dirname\s+\$0`/g, romDir);
        }

        // 跳过非 fastboot/adb 命令
        if (!/^(fastboot|adb)\s+/.test(cmd)) continue;

        // 含 shell 特殊字符（管道、重定向等）的视为 raw
        if (/[|><&;]/.test(cmd.replace(/^[^|><&;]*?\s+/, ''))) {
            steps.push({ type: 'raw', raw: cmd, risk: 'MEDIUM' });
            continue;
        }

        let m;

        // flash
        m = cmd.match(/^fastboot\s+flash\s+(\S+)\s+(.+)/i);
        if (m) {
            const partition = m[1];
            let imagePath = resolvePath(m[2]);

            if (!/\$[@*]|\$[1-9]/.test(imagePath) && (imagePath.includes('*') || imagePath.includes('?'))) {
                const dir = imagePath.substring(0, imagePath.lastIndexOf('/'));
                const pattern = imagePath.substring(imagePath.lastIndexOf('/') + 1);
                try {
                    const files = await ctx.fileApi.glob(pattern, dir);
                    if (files.length > 0) imagePath = files[0];
                } catch (_) {}
            }

            steps.push({
                type: 'flash',
                partition,
                imagePath,
                raw: `fastboot flash ${partition} ${imagePath}`,
                risk: 'MEDIUM'
            });
            continue;
        }

        // erase
        m = cmd.match(/^fastboot\s+erase\s+(\S+)/i);
        if (m) {
            steps.push({ type: 'erase', partition: m[1], raw: cmd, risk: 'HIGH' });
            continue;
        }

        // reboot
        m = cmd.match(/^fastboot\s+reboot\s*(\S*)/i);
        if (m) {
            const target = m[1] || 'system';
            steps.push({ type: 'reboot', target, raw: cmd, risk: 'LOW' });
            if (target === 'bootloader' || target === 'fastboot') {
                steps.push({ type: 'wait_reconnect', target, raw: 'wait for device reconnect', risk: 'LOW' });
            }
            continue;
        }

        // --set-active
        m = cmd.match(/^fastboot\s+--set-active\s*=\s*(\S+)/i);
        if (m) {
            steps.push({ type: 'set_active', partition: m[1], raw: cmd, risk: 'LOW' });
            continue;
        }

        // oem
        if (/^fastboot\s+oem\s+/i.test(cmd)) {
            steps.push({ type: 'oem', raw: cmd, risk: 'MEDIUM' });
            continue;
        }

        // flashing
        if (/^fastboot\s+flashing\s+/i.test(cmd)) {
            steps.push({ type: 'flashing', raw: cmd, risk: 'MEDIUM' });
            continue;
        }

        // adb shell
        if (/^adb\s+shell\s+/i.test(cmd)) {
            steps.push({ type: 'shell', raw: cmd, risk: 'MEDIUM' });
            continue;
        }

        // 其余 fastboot/adb 命令归为 raw（占位符原样保留）
        if (/^(fastboot|adb)\s+/.test(cmd)) {
            steps.push({ type: 'raw', raw: cmd, risk: 'MEDIUM' });
        }
    }

    // ★ 最后统一过滤：移除所有 raw 中包含 getvar 的步骤
    const filteredSteps = steps.filter(step => {
        if (step.type === 'raw' && /\bgetvar\b/i.test(step.raw)) {
            return false;
        }
        return true;
    });

    return { steps: filteredSteps };
}