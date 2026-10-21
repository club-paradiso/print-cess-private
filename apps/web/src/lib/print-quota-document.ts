import type { PrintQuotaDocument } from "@print-cess/protocol";

import type { ValidatedMobileFile } from "./file-validation";

export function quotaDocument(validated: ValidatedMobileFile): PrintQuotaDocument {
  return { pages: validated.pageCount, exact: validated.pageCountIsExact };
}
