import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

try {
  admin.app();
} catch {
  admin.initializeApp();
}

/**
 * Callable: setAdminClaim
 *
 * 功能：
 * 1) 首次自举：当系统尚未初始化（__meta/bootstrap.initialized != true），允许已登录的调用者把“自己”设为 admin，并写入初始化标记。
 * 2) 管理员管理：当调用者已是 admin 时，可为任意用户（通过 email 指定）开启/关闭 admin。
 *
 * 调用示例（客户端）：
 *   const fn = httpsCallable(functions, "setAdminClaim");
 *   await fn({ mode: "bootstrap" });
 *   await fn({ mode: "set", email: "someone@example.com", enable: true });
 */
export const setAdminClaim = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "需要先登录。");
  }

  const callerUid = context.auth.uid;

  // 读取调用者记录，判断是否已是 admin
  const callerRecord = await admin.auth().getUser(callerUid);
  const callerIsAdmin = callerRecord.customClaims?.admin === true;

  // 读取/创建引导标记
  const bootstrapRef = admin.firestore().doc("__meta/bootstrap");
  const snap = await bootstrapRef.get();
  const initialized = snap.exists && (snap.get("initialized") === true);

  const mode = String(data?.mode || "");
  if (!mode) {
    throw new functions.https.HttpsError("invalid-argument", "缺少参数 mode（bootstrap | set）。");
  }

  // --- 模式一：首次自举 ---
  if (mode === "bootstrap") {
    if (initialized) {
      // 系统已初始化：不允许再通过自举通道设管理员
      if (!callerIsAdmin) {
        throw new functions.https.HttpsError("permission-denied", "系统已初始化，需管理员操作。");
      }
      return { ok: true, note: "系统已初始化；调用者已是管理员或应使用 mode=set 管理他人。", initialized: true };
    }

    // 未初始化：允许“当前登录者”把自己设为 admin
    await admin.auth().setCustomUserClaims(callerUid, {
      ...(callerRecord.customClaims || {}),
      admin: true,
    });

    await bootstrapRef.set(
      {
        initialized: true,
        firstAdmin: callerUid,
        at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, bootstrap: true, uid: callerUid, admin: true };
  }

  // --- 模式二：管理员设置他人 ---
  if (mode === "set") {
    if (!callerIsAdmin) {
      throw new functions.https.HttpsError("permission-denied", "仅管理员可设置他人权限。");
    }
    const email = String(data?.email || "");
    const enable = Boolean(data?.enable ?? true);
    if (!email) {
      throw new functions.https.HttpsError("invalid-argument", "缺少参数 email。");
    }
    const target = await admin.auth().getUserByEmail(email);
    const nextClaims: Record<string, any> = { ...(target.customClaims || {}) };
    if (enable) nextClaims.admin = true;
    else delete nextClaims.admin;

    await admin.auth().setCustomUserClaims(target.uid, nextClaims);
    return { ok: true, uid: target.uid, email, admin: enable };
  }

  throw new functions.https.HttpsError("invalid-argument", "不支持的 mode。");
});

/**
 * [临时] HTTP: exportAllTradesV2
 *
 * 这是一个一次性的只读函数，用于导出所有历史数据。
 * 它会查询所有 'trades' 集合（collectionGroup），
 * 并将所有找到的文档（共 40 条）打印到 Firebase 函数日志中。
 *
 * 访问此函数的 URL 即可触发。
 */
export const exportAllTradesV2 = functions
  .region("us-central1") // 确保这个区域和您其他函数一致
  .https.onRequest(async (request, response) => {
    
    // 导入函数日志和 Firestore 实例
    const logger = functions.logger;
    const db = admin.firestore();

    logger.info("开始执行 [exportAllTradesV2] ...");

    const allData = [];

    try {
      // 1. (绕过“权限锁”) - 使用 collectionGroup 查询
      const snapshot = await db.collectionGroup("trades").get();
      
      logger.log(`collectionGroup('trades') 查询完毕，共找到 ${snapshot.size} 条总记录。`);

      // 2. (无筛选) - 导出所有找到的数据
      snapshot.forEach(doc => {
        const data = doc.data();
        
        // 我们不再筛选，将所有数据打包
        allData.push({
          original_path: doc.ref.path, // 包含原始路径，用于定位
          original_id: doc.id,
          data: data,
        });
      });

      // 3. (导出到日志)
      if (allData.length > 0) {
        logger.warn(`--- 成功导出 ${allData.length} 条数据 (JSON) ---`);
        
        // 将整个数组作为 JSON 打印到日志中
        logger.log(JSON.stringify(allData, null, 2));
        
        logger.warn(`--- 导出完毕 ---`);

        response.status(200).send(
          `查询成功！共找到 ${allData.length} 条数据。` + 
          `请立即前往 Firebase Console -> Functions -> “日志” 选项卡，` +
          `查看 "exportAllTradesV2" 函数的最新日志，即可复制 JSON 数据。`
        );
      } else {
        logger.info("查询完成，但在 'trades' collectionGroup 中未找到任何数据。");
        response.status(200).send("查询完成，未找到任何数据。");
      }

    } catch (error) {
      logger.error("执行 [exportAllTradesV2] 时发生严重错误:", error);
      response.status(500).send("查询失败，请检查函数日志获取详情。");
    }
  });
