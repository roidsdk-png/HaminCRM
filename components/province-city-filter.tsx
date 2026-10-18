'use client';

import { useMemo, useState } from 'react';
import locations from '@/lib/data/iran-locations.json';

type Props = {
  defaultProvince?: string;
  defaultCity?: string;
  className?: string;
};

const selectClass = 'h-11 w-full rounded-xl border border-border bg-background px-3 text-xs font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 md:text-sm';

export function ProvinceCityFilter({ defaultProvince = '', defaultCity = '', className = '' }: Props) {
  const [province, setProvince] = useState(defaultProvince);
  const cities = useMemo(
    () => locations.find((item) => item.name === province)?.cities ?? [],
    [province],
  );

  return (
    <div className={`grid min-w-[280px] flex-[2] grid-cols-2 gap-2 ${className}`}>
      <select
        name="province"
        value={province}
        aria-label="فیلتر استان"
        className={selectClass}
        onChange={(event) => setProvince(event.target.value)}
      >
        <option value="">همه استان‌ها</option>
        {locations.map((item) => (
          <option key={item.name} value={item.name}>{item.name}</option>
        ))}
      </select>
      <select
        key={province}
        name="city"
        defaultValue={cities.includes(defaultCity) ? defaultCity : ''}
        aria-label="فیلتر شهر"
        className={selectClass}
        disabled={!province}
      >
        <option value="">{province ? 'همه شهرهای استان' : 'ابتدا استان را انتخاب کنید'}</option>
        {cities.map((city) => (
          <option key={city} value={city}>{city}</option>
        ))}
      </select>
    </div>
  );
}
