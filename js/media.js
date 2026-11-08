// Photos : lecture GPS (EXIF) puis ré-encodage qui supprime toutes les métadonnées,
// coordonnées GPS comprises, avant envoi.

export async function readPhotoMeta(file) {
  try {
    const exifr = (await import('https://esm.sh/exifr@7.1.3')).default;
    const gps = await exifr.gps(file).catch(() => null);
    const tags = await exifr.parse(file, ['DateTimeOriginal']).catch(() => null);
    return {
      lat: gps?.latitude ?? null,
      lon: gps?.longitude ?? null,
      takenAt: tags?.DateTimeOriginal ? new Date(tags.DateTimeOriginal) : null,
    };
  } catch (e) {
    return { lat: null, lon: null, takenAt: null };
  }
}

export async function compressImage(file, max = 1600, quality = 0.82) {
  if (!file || !file.type.startsWith('image/')) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    bitmap = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bitmap.width, h = bitmap.height;
  const k = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  return blob || file;
}

export const MAX_VIDEO_MB = 50;
