import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

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
