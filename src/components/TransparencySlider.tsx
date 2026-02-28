import styles from "./TransparencySlider.module.css";
import { Eye } from "lucide-react";

interface TransparencySliderProps {
  value: number;
  onChange: (value: number) => void;
}

export default function TransparencySlider({ value, onChange }: TransparencySliderProps) {
  const pct = Math.round(value * 100);

  return (
    <div className={styles.container}>
      <Eye size={13} className={styles.icon} />
      <input
        type="range"
        min={10}
        max={100}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className={styles.slider}
        title={`Opacity: ${pct}%`}
      />
      <span className={styles.label}>{pct}%</span>
    </div>
  );
}
