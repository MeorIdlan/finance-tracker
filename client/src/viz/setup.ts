import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { VizTheme } from './theme';

let registered = false;

export function setupCharts(theme: VizTheme): void {
  if (!registered) {
    ChartJS.register(
      ArcElement,
      BarElement,
      CategoryScale,
      LinearScale,
      LineElement,
      PointElement,
      Filler,
      Legend,
      Tooltip,
    );
    registered = true;
  }
  ChartJS.defaults.font.family =
    'system-ui, -apple-system, "Segoe UI", sans-serif';
  ChartJS.defaults.color = theme.muted;
  ChartJS.defaults.borderColor = theme.grid;
  ChartJS.defaults.plugins.legend.labels.boxWidth = 12;
}
