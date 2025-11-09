
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { normalizeList } from "../lib/symbols/normalize";

const MAX_SINGLE_UPLOAD = 500;
const MAX_TOTAL_SYMBOLS = 2000;

// Note: App Check can be enforced for enhanced security.
// If your project has App Check configured, add `enforceAppCheck: true` to the options.
export const setEodSymbols = onCall(async (request) => {
  const { auth, data } = request;

  // 1. Authentication and Authorization
  if (!auth) {
    throw new HttpsError(
      "unauthenticated",
      "You must be logged in to call this function.",
    );
  }

  const isAdmin = auth.token.admin === true;
  let isAuthorized = isAdmin;

  if (!isAuthorized) {
    try {
      const adminDoc = await getFirestore().doc("meta/admins").get();
      if (adminDoc.exists) {
        const adminUids = adminDoc.data()?.uids;
        if (Array.isArray(adminUids) && adminUids.includes(auth.uid)) {
          isAuthorized = true;
        }
      }
    } catch (error) {
      logger.error("Error checking meta/admins document:", error);
      throw new HttpsError(
        "internal",
        "An internal error occurred while verifying permissions.",
      );
    }
  }

  if (!isAuthorized) {
    throw new HttpsError(
      "permission-denied",
      "You do not have permission to perform this action.",
    );
  }

  // 2. Input Validation
  const { list } = data;
  if (!Array.isArray(list)) {
    throw new HttpsError(
      "invalid-argument",
      "The 'list' parameter must be an array of strings.",
    );
  }

  // 3. Normalization and Processing
  let normalized;
  try {
    normalized = normalizeList(list, { maxSingle: MAX_SINGLE_UPLOAD });
  } catch (error: any) {
    throw new HttpsError("resource-exhausted", error.message);
  }

  const {
    valid: newValidSymbols,
    invalid: invalidSymbols,
    skipped: skippedSymbols,
  } = normalized;

  const eodSymbolsRef = getFirestore().doc("meta/eodSymbols");

  try {
    const currentDoc = await eodSymbolsRef.get();
    const currentSymbols: string[] = currentDoc.exists
      ? currentDoc.data()?.list ?? []
      : [];

    // Merge and de-duplicate with existing symbols
    const combined = new Set([...currentSymbols, ...newValidSymbols]);
    const nextList = Array.from(combined).sort();

    // 4. Resource Limit Checks
    if (nextList.length > MAX_TOTAL_SYMBOLS) {
      throw new HttpsError(
        "resource-exhausted",
        `The total number of symbols cannot exceed ${MAX_TOTAL_SYMBOLS}.`,
      );
    }

    // 5. Idempotency Check
    const isUnchanged =
      currentSymbols.length === nextList.length &&
      currentSymbols.every((symbol, index) => symbol === nextList[index]);

    if (isUnchanged) {
      return {
        updatedCount: 0,
        skippedSymbols,
        invalidSymbols: invalidSymbols.map((i) => i.symbol),
        total: currentSymbols.length,
        updatedAt: currentDoc.data()?.updatedAt?.toDate().toISOString() || new Date().toISOString(),
        updatedBy: currentDoc.data()?.updatedBy || "system (no change)",
      };
    }

    // 6. Firestore Write
    const updatedBy = auth.token.email || auth.uid;
    await eodSymbolsRef.set(
      {
        list: nextList,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy,
      },
      { merge: true },
    );

    const updatedCount = nextList.length - currentSymbols.length;

    return {
      updatedCount,
      skippedSymbols,
      invalidSymbols: invalidSymbols.map((i) => i.symbol),
      total: nextList.length,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }
    logger.error("Failed to update EOD symbols:", error);
    throw new HttpsError("internal", "An unexpected error occurred.");
  }
});
