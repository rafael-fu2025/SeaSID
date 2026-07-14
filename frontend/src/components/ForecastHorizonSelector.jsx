import { Button } from '@/components/ui/button';

const HORIZONS = [12, 24, 48];

export function ForecastHorizonSelector({ value, onChange }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Forecast horizon">
      {HORIZONS.map((hours) => (
        <Button
          key={hours}
          type="button"
          size="sm"
          variant={value === hours ? 'default' : 'outline'}
          aria-pressed={value === hours}
          onClick={() => onChange(hours)}
        >
          {hours}h
        </Button>
      ))}
    </div>
  );
}

export default ForecastHorizonSelector;
