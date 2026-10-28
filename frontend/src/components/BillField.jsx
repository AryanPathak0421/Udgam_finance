import { useRef, useState } from 'react';
import FormField from './ui/FormField.jsx';
import { compressImage } from '../utils/image.js';

const MAX_BYTES = 800 * 1024;

/** The bill / slip of an entry: a PDF or an image, optional. onChange(dataUrl, fileName); empty strings when it is removed. */
export default function BillField({ id, label = 'Bill', value, name, error, onChange, hint = 'Optional: a PDF or a photo of the bill (up to 800 KB)' }) {
  const ref = useRef(null);
  const [err, setErr] = useState('');
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    try {
      let data;
      if (file.type === 'application/pdf') {
        if (file.size > MAX_BYTES) throw new Error('The PDF must be 800 KB or smaller');
        data = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(new Error('Could not read the file'));
          fr.readAsDataURL(file);
        });
      } else if (/^image\/(png|jpeg)$/.test(file.type)) {
        data = await compressImage(file, { maxSide: 1600, quality: 0.75 });
      } else throw new Error('Choose a PDF or a PNG / JPEG image');
      onChange(data, file.name);
    } catch (ex) {
      setErr(ex.message);
    }
  }
  const isPdf = typeof value === 'string' && value.startsWith('data:application/pdf');
  return (
    <FormField id={id} label={label} error={err || error} hint={hint}>
      <div className="stamp-upload">
        {value ? (isPdf ? <div className="stamp-empty">{name || 'PDF'}</div> : <img src={value} alt={label} className="stamp-img" />) : <div className="stamp-empty">No bill</div>}
        <div className="stamp-actions">
          <input id={id} ref={ref} type="file" accept="application/pdf,image/png,image/jpeg" onChange={pick} hidden />
          <button type="button" className="btn sm" onClick={() => ref.current?.click()}>{value ? 'Change' : 'Upload'}</button>
          {value && <button type="button" className="btn sm danger-outline" onClick={() => onChange('', '')}>Remove</button>}
        </div>
      </div>
    </FormField>
  );
}
