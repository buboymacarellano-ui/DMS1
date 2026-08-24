(function attachDmsVehicleType(global) {
  function catalogKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function toUiVehicleType(value) {
    const key = catalogKey(value);
    const map = {
      small: 'small',
      smallsedan: 'small',
      medium: 'medium',
      large: 'Large',
      largeunit: 'Large',
      compactsuv: 'CompactSuv',
      vansuv: 'VanSuvPickUp',
      vansuvpickup: 'VanSuvPickUp',
      suvvanpickup: 'VanSuvPickUp',
      vanfullsuv: 'VanSuvPickUp',
      pickup: 'VanSuvPickUp',
      truck: 'Truck',
      walkin: 'Walk-In',
      equipment: 'Equipment',
      facility: 'Facility',
      tools: 'Tools',
    };
    return map[key] || '';
  }

  function findBrandName(catalog, brand) {
    const key = catalogKey(brand);
    if (!key) return '';
    return ((catalog && catalog.brandOptions) || []).find((name) => catalogKey(name) === key) || '';
  }

  function findModelEntry(catalog, brand, model) {
    const brandName = findBrandName(catalog, brand);
    const models = brandName && catalog && catalog.modelsByBrand
      ? (catalog.modelsByBrand[brandName] || [])
      : [];
    const key = catalogKey(model);
    if (!key) return null;
    return models.find((entry) => catalogKey(entry.model) === key) || null;
  }

  function lookupUnitType(catalog, brand, model) {
    const entry = findModelEntry(catalog, brand, model);
    if (!entry) return null;
    return {
      brand: findBrandName(catalog, brand),
      model: entry.model,
      vehicleType: entry.vehicleType,
      vehicleTypeUi: entry.vehicleTypeUi || toUiVehicleType(entry.vehicleType),
    };
  }

  global.DmsVehicleType = {
    catalogKey: catalogKey,
    findBrandName: findBrandName,
    findModelEntry: findModelEntry,
    lookupUnitType: lookupUnitType,
    toUiVehicleType: toUiVehicleType,
  };
})(window);
