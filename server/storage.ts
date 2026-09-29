import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import fs from 'node:fs/promises';
import path from 'node:path';
import {dataDir} from './db.js';
import {fail} from './auth.js';
const s3=process.env.S3_ENDPOINT?new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION||'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID||'',secretAccessKey:process.env.S3_SECRET_ACCESS_KEY||''}}):null;
const bucket=process.env.S3_BUCKET||'helm-screenshots';
let sharpModule: any = null;
async function getSharp() {
  if (sharpModule === null) {
    try {
      const s = await import('sharp');
      sharpModule = s.default || s;
    } catch {
      sharpModule = false;
    }
  }
  return sharpModule;
}

export async function validateImage(buffer: Buffer, mime: string) {
  const normMime = (mime || '').toLowerCase().trim();
  const isJpgMime = normMime === 'image/jpeg' || normMime === 'image/jpg' || normMime === 'image/pjpeg';
  const isPngMime = normMime === 'image/png';
  const isWebpMime = normMime === 'image/webp';

  const format = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'png'
    : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
    ? 'jpeg'
    : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
    ? 'webp'
    : null;

  if (!format) throw fail(400, 'Only valid PNG, JPEG and WebP screenshots are allowed.');
  if (format === 'png' && !isPngMime) throw fail(400, 'Invalid image format (PNG expected).');
  if (format === 'jpeg' && !isJpgMime) throw fail(400, 'Invalid image format (JPEG expected).');
  if (format === 'webp' && !isWebpMime) throw fail(400, 'Invalid image format (WebP expected).');

  try {
    const sharp = await getSharp();
    if (sharp) {
      const meta = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
      if (meta.pages && meta.pages > 1) throw new Error('Animated image');
      return await sharp(buffer, { limitInputPixels: 40_000_000 }).toFormat(format).toBuffer();
    }
  } catch (err: any) {
    if (err.message === 'Animated image') throw fail(400, 'The image is animated.');
  }
  return buffer;
}
export async function put(key:string,buffer:Buffer,mime:string){
  if(s3)await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:buffer,ContentType:mime}));
  else{
    const uploadDir = path.join(dataDir,'uploads');
    try{await fs.mkdir(uploadDir,{recursive:true});}catch{}
    await fs.writeFile(path.join(uploadDir,key),buffer,{mode:0o600});
  }
}
export async function remove(key:string){if(s3)await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));else await fs.rm(path.join(dataDir,'uploads',key),{force:true});}
export async function download(key:string){return s3?{url:await getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:60})}:{file:path.join(dataDir,'uploads',key)};}
