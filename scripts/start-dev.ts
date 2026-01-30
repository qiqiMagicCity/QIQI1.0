
import { spawn, execSync } from 'child_process';
import { platform } from 'os';

const PORT = 9002;

/**
 * 检查端口是否被占用，如果被占用则杀掉进程
 */
function killPort(port: number) {
    try {
        const isWindows = platform() === 'win32';
        console.log(`[启动助手] 正在检查端口 ${port} 占用情况...`);

        if (isWindows) {
            // 查找占用端口的 PID
            let output = '';
            try {
                output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
            } catch (e) {
                // netstat 找不到匹配项时会抛错，这是正常现象
                console.log(`[启动助手] 端口 ${port} 当前空闲。`);
                return;
            }

            if (output) {
                console.log(`[启动助手] 发现端口 ${port} 被占用，准备清理...`);
                // 打印原始输出以便调试
                // console.log(output);

                const lines = output.split('\n');
                const pids = new Set<string>();

                lines.forEach(line => {
                    // TCP    0.0.0.0:9002           0.0.0.0:0              LISTENING       22652
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && /^\d+$/.test(pid) && pid !== '0') {
                        pids.add(pid);
                    }
                });

                if (pids.size > 0) {
                    pids.forEach(pid => {
                        try {
                            console.log(`[端口清理] 正在强制终止进程 PID: ${pid}`);
                            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
                        } catch (e: any) {
                            console.log(`[端口清理] 终止 PID ${pid} 失败 (可能已自动退出): ${e.message}`);
                        }
                    });

                    // 循环检查直到端口释放
                    let checks = 0;
                    while (checks < 10) {
                        try {
                            const check = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
                            if (!check) {
                                console.log(`[端口清理] 端口 ${port} 已成功释放。`);
                                return;
                            }
                            // 再次仔细检查
                            const stillBound = check.split('\n').some(l => l.includes(`:${port}`));
                            if (!stillBound) {
                                console.log(`[端口清理] 端口 ${port} 已成功释放。`);
                                return;
                            }
                        } catch {
                            // findstr 失败意味着没有输出 -> 端口空闲
                            console.log(`[端口清理] 端口 ${port} 已成功释放。`);
                            return;
                        }

                        console.log(`[端口清理] 等待端口释放... (${checks + 1}/10)`);
                        execSync('timeout /t 1 /nobreak > nul', { shell: 'cmd.exe' });
                        checks++;
                    }
                    console.warn(`[警告] 端口 ${port} 清理后可能仍被占用，尝试继续启动...`);
                }
            }
        } else {
            // Linux/Mac implementation
            const getPid = () => {
                try {
                    return execSync(`lsof -t -i:${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
                } catch { return ''; }
            };

            let pid = getPid();
            if (pid) {
                console.log(`[端口清理] 发现端口 ${port} 被占用 (PID: ${pid})，正在清理...`);
                const pids = pid.split('\n');
                pids.forEach(p => {
                    try { execSync(`kill -9 ${p}`, { stdio: 'ignore' }); } catch { }
                });

                // Wait for release
                let retries = 10;
                while (retries > 0 && getPid()) {
                    console.log(`[端口清理] 等待端口 ${port} 释放...`);
                    execSync('sleep 1');
                    retries--;
                }
                console.log(`[端口清理] 端口 ${port} 已清理。`);
            } else {
                console.log(`[启动助手] 端口 ${port} 当前空闲。`);
            }
        }
    } catch (error: any) {
        console.error('[错误] 端口清理过程中发生异常:', error.message);
    }
}

async function startDev() {
    console.log(`==================================================`);
    console.log(`   QIQI1.0 开发服务器启动助手 (端口 ${PORT})`);
    console.log(`==================================================`);

    // 1. 清理端口
    killPort(PORT);

    // 2. 启动 Next.js
    console.log(`[启动助手] 正在启动 Next.js 开发服务器...`);

    // 使用 npm exec next 确保找到正确的二进制文件
    // -H 127.0.0.1 强制绑定 IPv4 本地地址，避免 Windows 上 localhost 解析问题
    const cmd = platform() === 'win32' ? 'npm.cmd' : 'npm';

    // 我们直接调用 next 命令，而不是 run dev，因为 run dev 会递归调用此脚本
    // 但是这里 package.json script "dev" IS running this script.
    // So we need to call 'next' directly.

    const next = spawn(cmd, ['exec', 'next', 'dev', '--', '-p', String(PORT), '-H', '127.0.0.1'], {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, FORCE_COLOR: '1' } // 保持彩色输出
    });

    next.on('error', (err) => {
        console.error('[启动助手] 启动失败:', err);
    });

    next.on('close', (code) => {
        if (code !== 0 && code !== null) {
            console.log(`[启动助手] Next.js 异常退出，退出码: ${code}`);
        } else {
            console.log('[启动助手] 服务已停止。');
        }
        process.exit(code ?? 0);
    });
}

startDev();
