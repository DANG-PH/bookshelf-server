import { BadRequestException } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { extname } from 'path';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';

const PDF_TYPES = ['application/pdf'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// multer's diskStorage never creates its destination folder — it just
// fails the upload if it's missing. UPLOAD_DIR is commonly a mounted
// volume kept outside the git repo specifically so deploys don't touch
// it, so a subfolder a new feature needs can easily not
// exist yet on a server that's never had one before. Cheap to make this
// self-healing instead of a silent 500 on the first upload.
function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

// single storage engine shared by the "file" (pdf) and "cover" (image)
// fields — routes each upload to its own subfolder by fieldname
export function bookAssetsStorage(uploadDir: string) {
  return diskStorage({
    destination: (_req, file, cb) => {
      const subfolder = file.fieldname === 'cover' ? 'covers' : 'books';
      cb(null, ensureDir(`${uploadDir}/${subfolder}`));
    },
    filename: (_req, file, cb) => {
      cb(null, `${uuidv4()}${extname(file.originalname).toLowerCase()}`);
    },
  });
}

export function pdfFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!PDF_TYPES.includes(file.mimetype)) {
    return cb(new BadRequestException('File sách phải là PDF'), false);
  }
  cb(null, true);
}

export function imageFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!IMAGE_TYPES.includes(file.mimetype)) {
    return cb(
      new BadRequestException('Ảnh bìa phải là JPG, PNG, WEBP hoặc GIF'),
      false,
    );
  }
  cb(null, true);
}

export const MAX_PDF_SIZE_BYTES = 80 * 1024 * 1024; // 80MB

// routes to the right mimetype check based on which form field the file
// came in on ("file" = the book PDF, "cover" = the cover image)
export function bookAssetsFileFilter(
  req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  if (file.fieldname === 'cover') return imageFileFilter(req, file, cb);
  return pdfFileFilter(req, file, cb);
}
