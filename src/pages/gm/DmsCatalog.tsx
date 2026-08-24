import React, { useMemo, useState } from 'react';
import './DmsCatalog.css';

export type DmsCatalogProps = {
  /** Return to the prior portal view (typically GM dashboard). */
  onBack?: () => void;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  activeEngine?: string;
};

const CATALOG_BRANDS = [
  'WHI ACES',
  'Car & Trucks',
  'Exhausts',
  'Agricultural',
  'Heavy-Duty',
  'Power-Sport',
  'Marine',
  'GM AC-Delco',
  'AC Delco',
  'Federated',
] as const;

const ENGINE_OPTIONS = [
  'V6-217cid 3.5L FI VIN N LZE',
  'V6-262cid 4.3L FI VIN X LU3',
  'V8-294cid 4.8L FI VIN C LY2',
  'V8-325cid 5.3L FLEX FI VIN 0 LMG',
  'V8-325cid 5.3L FI VIN J LY5',
  'V8-325cid 5.3L FI VIN 3 LC9',
  'V8-364cid 6.0L FI VIN K LY6',
  'V8-364cid 6.0L FI VIN Y L76',
] as const;

const CATEGORY_OPTIONS = [
  'Ignition/Filters',
  'Belts/Hoses/Cooling',
  'Electrical',
  'Brake',
  'Fuel',
  'Heating/AC',
  'Steering/Suspension',
  'Transmission',
  'Exhaust',
  'Wipers/Lighting',
  'Engine Mechanical',
  'Driveline',
] as const;

const GROUP_OPTIONS = [
  'Filters & PCV',
  'Tune-Up and Ignition',
  'Spark Plugs',
  'Air Filters',
  'Oil Filters',
  'Fuel Filters',
  'Cabin Air Filters',
  'PCV Valves',
  'Ignition Coils',
  'Wire Sets',
] as const;

const VEHICLE_HISTORY = [
  '2008 - CHEVROLET - SILVERADO 1500 - V8-325CID 5.3L FLEX FI VIN 0 LMG',
  '2015 - TOYOTA - CAMRY - V6-207CID 3.5L FI VIN 2 2GRFE',
  '2019 - FORD - F-150 - V8-302CID 5.0L FI VIN F COYOTE',
  '2012 - HONDA - CR-V - L4-144CID 2.4L FI VIN 5 K24Z7',
] as const;

const DEFAULT_ENGINE = 'V8-325cid 5.3L FLEX FI VIN 0 LMG';

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * Standalone DEMO DMS DX Catalog lookup surface.
 * Mirrors the classic dual-header / brand sidebar / 3-column ACES selection layout.
 */
export default function DmsCatalog({
  onBack,
  vehicleYear = '2008',
  vehicleMake = 'CHEVROLET',
  vehicleModel = 'SILVERADO 1500',
  activeEngine = DEFAULT_ENGINE,
}: DmsCatalogProps) {
  const [activeBrand, setActiveBrand] = useState<(typeof CATALOG_BRANDS)[number]>('WHI ACES');
  const [selectedEngine, setSelectedEngine] = useState(activeEngine);
  const [categories, setCategories] = useState<string[]>(['Ignition/Filters']);
  const [groups, setGroups] = useState<string[]>(['Filters & PCV', 'Tune-Up and Ignition', 'Spark Plugs']);
  const [vinQuery, setVinQuery] = useState('');
  const [partQuery, setPartQuery] = useState('');
  const [descriptionQuery, setDescriptionQuery] = useState('');
  const [historyPath, setHistoryPath] = useState<string>(VEHICLE_HISTORY[0]);

  const vehiclePath = useMemo(() => {
    const engineLabel = selectedEngine.toUpperCase();
    return `${vehicleYear} - ${vehicleMake} - ${vehicleModel} - ${engineLabel}`;
  }, [selectedEngine, vehicleMake, vehicleModel, vehicleYear]);

  function handleGo() {
    // UI shell only — selection state is ready for a future parts lookup API.
    window.alert(
      [
        'Catalog search ready',
        `Brand: ${activeBrand}`,
        `Engine: ${selectedEngine}`,
        `Categories: ${categories.join(', ') || '(none)'}`,
        `Groups: ${groups.join(', ') || '(none)'}`,
      ].join('\n')
    );
  }

  function runModuleSearch(kind: 'VIN' | 'Part' | 'Description', value: string) {
    const trimmed = value.trim();
    window.alert(
      trimmed
        ? `${kind} search / interchange: ${trimmed}`
        : `Enter a ${kind} value to search or interchange.`
    );
  }

  return (
    <section className="dms-catalog" aria-label="DEMO DMS DX Catalog">
      <header className="dms-catalog__topbar">
        <div className="dms-catalog__brand">
          <span className="dms-catalog__mark" aria-hidden="true">
            DX
          </span>
          <h1 className="dms-catalog__title">
            DEMO DMS <span className="dms-catalog__title-accent">DX Catalog</span>
          </h1>
        </div>
        <div className="dms-catalog__top-actions">
          {onBack ? (
            <button type="button" className="dms-catalog__back" onClick={onBack}>
              ← Dashboard
            </button>
          ) : null}
        </div>
      </header>

      <div className="dms-catalog__vehicle-stripe" aria-live="polite">
        <span className="dms-catalog__vehicle-label">VEHICLE</span>
        <span className="dms-catalog__vehicle-path">{vehiclePath}</span>
      </div>

      <div className="dms-catalog__body">
        <aside className="dms-catalog__sidebar" aria-label="Catalog brands">
          {CATALOG_BRANDS.map((brand) => (
            <button
              key={brand}
              type="button"
              className={`dms-catalog__brand-btn${activeBrand === brand ? ' is-active' : ''}`}
              aria-pressed={activeBrand === brand}
              onClick={() => setActiveBrand(brand)}
            >
              {brand}
            </button>
          ))}
        </aside>

        <div className="dms-catalog__main">
          <section className="dms-catalog__column" aria-label="Vehicle engine specifications">
            <div className="dms-catalog__column-header">Vehicle / Engine</div>
            <div className="dms-catalog__column-body">
              <ul className="dms-catalog__engine-list">
                {ENGINE_OPTIONS.map((engine) => (
                  <li key={engine}>
                    <button
                      type="button"
                      className={`dms-catalog__engine-btn${
                        selectedEngine === engine ? ' is-active' : ''
                      }`}
                      aria-pressed={selectedEngine === engine}
                      onClick={() => setSelectedEngine(engine)}
                    >
                      {engine}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="dms-catalog__column" aria-label="Part categories">
            <div className="dms-catalog__column-header">Categories</div>
            <div className="dms-catalog__column-body">
              <ul className="dms-catalog__check-list">
                {CATEGORY_OPTIONS.map((category) => (
                  <li key={category}>
                    <label className="dms-catalog__check-item">
                      <input
                        type="checkbox"
                        checked={categories.includes(category)}
                        onChange={() => setCategories((prev) => toggleValue(prev, category))}
                      />
                      <span>{category}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="dms-catalog__column" aria-label="Part groups">
            <div className="dms-catalog__column-header">Groups</div>
            <div className="dms-catalog__column-body">
              <ul className="dms-catalog__check-list">
                {GROUP_OPTIONS.map((group) => (
                  <li key={group}>
                    <label className="dms-catalog__check-item">
                      <input
                        type="checkbox"
                        checked={groups.includes(group)}
                        onChange={() => setGroups((prev) => toggleValue(prev, group))}
                      />
                      <span>{group}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <button type="button" className="dms-catalog__go" onClick={handleGo} aria-label="Run catalog search">
            GO
          </button>
        </div>
      </div>

      <footer className="dms-catalog__footer">
        <div className="dms-catalog__query-row">
          <div className="dms-catalog__query-module">
            <label htmlFor="dms-vin-query">VIN #</label>
            <input
              id="dms-vin-query"
              type="text"
              value={vinQuery}
              onChange={(event) => setVinQuery(event.target.value)}
              placeholder="Enter VIN"
              autoComplete="off"
            />
            <button
              type="button"
              className="dms-catalog__query-action"
              onClick={() => runModuleSearch('VIN', vinQuery)}
            >
              Search / Interchange
            </button>
          </div>

          <div className="dms-catalog__query-module">
            <label htmlFor="dms-part-query">Part</label>
            <input
              id="dms-part-query"
              type="text"
              value={partQuery}
              onChange={(event) => setPartQuery(event.target.value)}
              placeholder="Part number"
              autoComplete="off"
            />
            <button
              type="button"
              className="dms-catalog__query-action"
              onClick={() => runModuleSearch('Part', partQuery)}
            >
              Search / Interchange
            </button>
          </div>

          <div className="dms-catalog__query-module">
            <label htmlFor="dms-description-query">Description</label>
            <input
              id="dms-description-query"
              type="text"
              value={descriptionQuery}
              onChange={(event) => setDescriptionQuery(event.target.value)}
              placeholder="Part description"
              autoComplete="off"
            />
            <button
              type="button"
              className="dms-catalog__query-action"
              onClick={() => runModuleSearch('Description', descriptionQuery)}
            >
              Search / Interchange
            </button>
          </div>
        </div>

        <div className="dms-catalog__history">
          <label htmlFor="dms-vehicle-history">Vehicle History</label>
          <select
            id="dms-vehicle-history"
            value={historyPath}
            onChange={(event) => setHistoryPath(event.target.value)}
            aria-label="Vehicle history selector"
          >
            {VEHICLE_HISTORY.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </div>
      </footer>
    </section>
  );
}
