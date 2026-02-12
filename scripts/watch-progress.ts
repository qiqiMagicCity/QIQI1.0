
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import * as readline from 'readline';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = getFirestore();

interface BackfillStatus {
    isActive: boolean;
    mode: 'stock' | 'option' | 'done';
    current: number;
    total: number;
    progressPercent: number;
    currentSymbol: string;
    totalFixed: number;
    lastFixed: string;
    updatedAt: any;
}

// Helper to clear console and update in place
const printProgress = (status: BackfillStatus) => {
    // Clear whole screen is messy, better reprint lines
    console.clear();

    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║       🚀 EOD 历史数据修复进度监控           ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    const { mode, current, total, progressPercent, currentSymbol, totalFixed, lastFixed } = status;

    // Status Icon
    const icon = status.isActive ? '🔄' : (mode === 'done' ? '✅' : '⏸️');

    console.log(`状态: ${icon} ${status.isActive ? '正在运行' : '已停止'} (${mode.toUpperCase()})`);

    // Progress Bar
    const width = 40;
    const filled = Math.round((width * progressPercent) / 100);
    const empty = width - filled;
    // Use block chars
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    console.log(`进度: [${bar}] ${progressPercent}%`);
    console.log(`      ${current} / ${total} 资产`);

    console.log('\n----------------------------------------');
    console.log(`📦 当前处理: \x1b[36m${currentSymbol}\x1b[0m`);
    console.log(`🔧 已修复条目: \x1b[32m${totalFixed}\x1b[0m`);
    console.log(`📝 最新日志: ${lastFixed}`);
    console.log('----------------------------------------\n');

    if (mode === 'done' && !status.isActive) {
        console.log('🎉 所有任务已完成！\n');
        process.exit(0);
    }
};

console.log('👀 正在连接进度流...');

// Watch Firestore document
const docRef = db.collection('system').doc('backfill_status');
const unsubscribe = docRef.onSnapshot(doc => {
    if (!doc.exists) {
        console.log('❌ 暂无进度数据...');
    } else {
        const data = doc.data() as any;
        printProgress(data);
    }
}, err => {
    console.error('❌ 监听错误:', err);
});

// Keep process alive
setInterval(() => { }, 1000);
