import { MAX_PLAINTEXT_BYTES } from "@print-cess/protocol";

import {
  FileValidationError,
  readSelectedFileBytes,
  validateFileForMobile,
  type ValidatedMobileFile,
} from "./file-validation";
import { isHwpSelection, validateHwpHeader } from "./hwp-validation";

export { FileValidationError } from "./file-validation";
export type { ValidatedMobileFile } from "./file-validation";

export async function validateMobileDocument(
  file: File,
  options: { allowHwp?: boolean; allowHwpx?: boolean; trustedGeneratedPdf?: boolean } = {},
): Promise<ValidatedMobileFile> {
  if (!isHwpSelection(file)) {
    return validateFileForMobile(file, {
      ...(options.allowHwpx === undefined ? {} : { allowHwpx: options.allowHwpx }),
      ...(options.trustedGeneratedPdf === undefined
        ? {}
        : { trustedGeneratedPdf: options.trustedGeneratedPdf }),
    });
  }

  if (file.size > MAX_PLAINTEXT_BYTES) throw new FileValidationError("tooLarge");
  if (!options.allowHwp) throw new FileValidationError("hwpxUnavailable");

  const bytes = await readSelectedFileBytes(file);
  if (bytes.byteLength > MAX_PLAINTEXT_BYTES) throw new FileValidationError("tooLarge");
  try {
    validateHwpHeader(bytes);
  } catch {
    bytes.fill(0);
    throw new FileValidationError("damagedFile");
  }

  return {
    bytes,
    fileKind: "hwp",
    pageCount: 1,
    pageCountIsExact: false,
    normalized: false,
  };
}
