import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import './export'; // 导入新文件以确保它被部署

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
