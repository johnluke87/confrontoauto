import { describe, expect, it } from 'vitest';
import { Parameter, RoadTaxRule } from '../../models/catalog';
import { CatalogRow } from '../../models/catalog-row';
import { carCosts, chargeSustaining, costContext, costFields, FALLBACK_INPUTS, insuranceFactor, partsFactor, tireFactor, utilityFactor, yearlyEnergy } from './catalog-costs';

const PARAMS: Record<string, number> = {
  insurance_year: 430,
  unexpected_year: 270,
  service_price: 250,
  service_years: 2,
  revision_price: 80,
  tire_set_price: 340,
  tire_set_every_km: 60000,
  brakes_job: 300,
  brakes_every_km: 130000,
  clutch_job: 400,
  clutch_every_km: 150000,
  timing_belt_job: 200,
  timing_belt_every_years: 8,
  lpg_tank_job: 700,
  lpg_tank_year: 10,
  cng_tank_check_price: 150,
  cng_tank_check_every_years: 4,
  battery_12v_price: 100,
  battery_12v_every_years: 3,
  wallbox_price: 1300,
  superbollo_eur_kw: 20,
  charging_losses_pct: 10,
  phev_electric_share_pct: 50,
};
const parameters = Object.entries(PARAMS).map(([code, value]) => ({ code, value }) as Parameter);
const rule = (fuelGroup: RoadTaxRule['fuelGroup'], exemptYears = 0, afterExemptPct = 100) =>
  ({ fuelGroup, rateUpTo100Kw: 2.84, rateOver100Kw: 4.26, exemptYears, afterExemptPct }) as RoadTaxRule;
const roadTax = [rule('thermal'), rule('lpg_cng'), rule('hybrid', 3), rule('plugin_hybrid', 3), rule('electric', 5, 25)];
const ctx = costContext(FALLBACK_INPUTS, parameters, roadTax);

function car(changes: Partial<CatalogRow>): CatalogRow {
  return {
    variantId: 1,
    fuel: 'petrol',
    powertrain: '1.0 TCe',
    // l'auto di riferimento dei parametri: 1.350 kg, 90 kW, 1.300 cc, 205/55 R16
    powerKw: 90,
    powerCv: 122,
    weightKg: 1350,
    displacementCc: 1300,
    tireSize: '205/55 R16',
    gearbox: 'manual',
    timing: 'belt',
    consumption: 5.5,
    consumptionUnit: 'l_100km',
    electricConsumption: null,
    electricRangeKm: null,
    co2: null,
    realConsumption: null,
    realKwh100km: null,
    realEvShare: null,
    realFactor: null,
    realVehicles: null,
    realLevel: null,
    listPrice: 20000,
    onRoadPrice: null,
    ...changes,
  } as CatalogRow;
}

describe('stima dei costi', () => {
  it('benzina manuale: carburante, bollo e lavori negli anni giusti', () => {
    const costs = carCosts(car({}), ctx)!;
    // 5,5 l/100km × 175 × 2 €/l
    expect(costs.energyYear).toBeCloseTo(1925);
    const fixed = 1925 + 430 + 270 + 90 * 2.84;
    expect(costs.years[0]).toBeCloseTo(fixed + 250); // tagliando
    expect(costs.years[2]).toBeCloseTo(fixed + 100); // batteria 12V al 3° anno
    expect(costs.years[3]).toBeCloseTo(fixed + 80 + 340); // revisione + gomme (70.000 km)
    expect(costs.years[7]).toBeCloseTo(fixed + 80 + 200 + 300); // revisione + cinghia + freni (140.000 km)
    expect(costs.years[8]).toBeCloseTo(fixed + 400 + 100); // frizione (157.500 km) + batteria
  });

  it('totale = prezzo + gestione, gestione/anno = media dei primi 10 anni', () => {
    const row = car({ onRoadPrice: 21000 });
    const f = costFields(row, ctx);
    const years = carCosts(row, ctx)!.years;
    const ten = years.slice(0, 10).reduce((a, b) => a + b, 0);
    expect(f.running10).toBe(Math.round(ten));
    expect(f.runningYear).toBe(Math.round(ten / 10));
    expect(f.total10).toBe(Math.round(21000 + ten));
    expect(f.total15).toBe(Math.round(21000 + years.reduce((a, b) => a + b, 0)));
  });

  it('elettrica: corrente con le perdite, bollo esente 5 anni poi 25%, wallbox il primo anno, niente cinghia e frizione', () => {
    const row = car({ fuel: 'electric', gearbox: 'automatic', timing: null, consumption: 15, consumptionUnit: 'kwh_100km', powerKw: 100 });
    const costs = carCosts(row, ctx)!;
    expect(costs.energyYear).toBeCloseTo(15 * 1.1 * 175 * 0.3);
    expect(costs.years[0] - costs.years[1]).toBeCloseTo(1300); // wallbox
    const base = costs.energyYear + 430 * 1.25 + 270; // RC per potenza: 100 kW
    expect(costs.years[4]).toBeCloseTo(base); // 5° anno: bollo ancora esente
    expect(costs.years[5]).toBeCloseTo(base + 80 + 100 + 284 * 0.25); // revisione + batteria + bollo ridotto
    expect(costs.years[7]).toBeCloseTo(base + 80 + 284 * 0.25); // 8° anno: niente freni (rigenerativi: ogni 260.000 km)
  });

  it('GPL e metano: prezzo giusto e serbatoi', () => {
    const lpg = carCosts(car({ fuel: 'lpg', consumption: 7 }), ctx)!;
    expect(lpg.energyYear).toBeCloseTo(7 * 175 * 0.8);
    const cng = carCosts(car({ fuel: 'cng', consumption: 3.5, consumptionUnit: 'kg_100km' }), ctx)!;
    expect(cng.energyYear).toBeCloseTo(3.5 * 175 * 1.55);
    const petrol = carCosts(car({}), ctx)!;
    expect(lpg.years[9] - lpg.energyYear - (petrol.years[9] - petrol.energyYear)).toBeCloseTo(700); // serbatoio al 10° anno
    expect(cng.years[3] - cng.energyYear - (petrol.years[3] - petrol.energyYear)).toBeCloseTo(150); // collaudo al 4°
  });

  it('ibrida diesel riconosciuta dal nome del motore', () => {
    const row = car({ fuel: 'mild_hybrid', powertrain: '2.0 EcoBlue mHEV' });
    expect(yearlyEnergy(row, ctx)!.cost).toBeCloseTo(5.5 * 175 * 2.2);
  });

  it('plug-in: metà km in elettrico, il resto con il consumo a batteria scarica', () => {
    expect(utilityFactor(60)).toBeGreaterThan(0.75);
    expect(utilityFactor(60)).toBeLessThan(0.85);
    expect(chargeSustaining(1.0, 60)).toBeGreaterThan(4);
    expect(chargeSustaining(6, 60)).toBe(6);
    const row = car({ fuel: 'plugin_hybrid', consumption: 1.0, electricConsumption: 17, electricRangeKm: 60 });
    const expected = 0.5 * 17 * 1.1 * 175 * 0.3 + 0.5 * chargeSustaining(1.0, 60) * 175 * 2.0;
    expect(yearlyEnergy(row, ctx)!.cost).toBeCloseTo(expected);
  });

  it('superbollo oltre 185 kW, ridotto dopo 5 anni', () => {
    const big = carCosts(car({ powerKw: 235 }), ctx)!;
    const small = carCosts(car({ powerKw: 185 }), ctx)!;
    expect(big.years[0] - small.years[0]).toBeCloseTo(50 * 4.26 + 50 * 20);
    expect(big.years[5] - small.years[5]).toBeCloseTo(50 * 4.26 + 50 * 20 * 0.6);
  });

  it('consumo reale UE: stessa versione, rapporto del modello, altrimenti WLTP + %', () => {
    const version = costFields(car({ realConsumption: 7.1, realFactor: 1.25, realVehicles: 3313, realLevel: 'version' }), ctx);
    expect(version.usedConsumption).toBe(7.1);
    expect(version.energyYear).toBe(Math.round(7.1 * 175 * 2.0));
    expect(version.costNote).toBe('consumo reale UE: 3.313 auto, stessa versione');
    const model = costFields(car({ realFactor: 1.2, realVehicles: 900, realLevel: 'model' }), ctx);
    expect(model.usedConsumption).toBe(6.6);
    expect(model.costNote).toContain('stesso modello (WLTP +20%)');
    const pctCtx = costContext({ ...FALLBACK_INPUTS, realPct: 115 }, parameters, roadTax);
    expect(costFields(car({}), pctCtx).usedConsumption).toBeCloseTo(6.3);
    expect(costFields(car({}), pctCtx).costNote).toBe('consumo: WLTP +15%');
    // i dati UE vincono sulla percentuale scelta in alto
    expect(costFields(car({ realConsumption: 7.1, realVehicles: 50, realLevel: 'version' }), pctCtx).usedConsumption).toBe(7.1);
  });

  it('plug-in con dati UE: litri su tutti i km + corrente dalla presa', () => {
    const row = car({ fuel: 'plugin_hybrid', consumption: 1.0, electricConsumption: 17, electricRangeKm: 60, realConsumption: 6.68, realKwh100km: 4.23, realEvShare: 0.194, realVehicles: 663, realLevel: 'version' });
    const energy = yearlyEnergy(row, ctx)!;
    expect(energy.cost).toBeCloseTo(6.68 * 175 * 2.0 + 4.23 * 1.1 * 175 * 0.3);
    expect(energy.note).toBe('consumo reale UE: 663 auto, stessa versione, 19% dei km in elettrico');
  });

  it('RC per cilindrata, per potenza se elettrica o senza cilindrata', () => {
    expect(insuranceFactor({ fuel: 'petrol', displacementCc: 999 }, 51)).toBe(0.85);
    expect(insuranceFactor({ fuel: 'petrol', displacementCc: 1332 }, 96)).toBe(1);
    expect(insuranceFactor({ fuel: 'diesel', displacementCc: 1968 }, 110)).toBe(1.25);
    expect(insuranceFactor({ fuel: 'petrol', displacementCc: 2998 }, 280)).toBe(1.7);
    expect(insuranceFactor({ fuel: 'electric', displacementCc: null }, 150)).toBe(1.45);
    expect(insuranceFactor({ fuel: 'petrol', displacementCc: null }, 70)).toBe(1);
  });

  it('gomme dalla misura, ricambi da peso e potenza', () => {
    expect(tireFactor('205/55 R16 91V', 9)).toBeCloseTo(1);
    expect(tireFactor('175/65R14', 9)).toBeCloseTo(0.7 * 175 / 205);
    expect(tireFactor('245/35 ZR19 / 265/35 ZR19', 9)).toBeCloseTo(1.9 * 245 / 205);
    expect(tireFactor(null, 1.3)).toBe(1.3);
    expect(partsFactor(980, 51)).toBe(0.7); // citycar: minimo
    expect(partsFactor(1350, 90)).toBe(1);
    expect(partsFactor(1500, 290)).toBeCloseTo((1500 / 1350 + 290 / 90) / 2);
    expect(partsFactor(null, 45)).toBe(0.7);
  });

  it('citycar e sportiva: ricambi in proporzione', () => {
    const city = carCosts(car({ weightKg: 980, powerKw: 51, displacementCc: 999, tireSize: '175/65 R14' }), ctx)!;
    const sport = carCosts(car({ weightKg: 1500, powerKw: 180, displacementCc: 1984, tireSize: '235/35 R19' }), ctx)!;
    // 8° anno: cinghia + freni (+ revisione, uguale per tutte)
    expect(sport.years[7] - city.years[7]).toBeGreaterThan(300);
  });

  it('consumo mancante: dalla CO₂, altrimenti da peso e potenza (con la nota)', () => {
    const fromCo2 = carCosts(car({ consumption: null, co2: 139 }), ctx)!;
    expect(fromCo2.energyYear).toBeCloseTo((139 / 23.1) * 175 * 2.0);
    expect(fromCo2.guesses).toEqual(['consumo ricavato dalla CO₂']);
    const diesel = carCosts(car({ fuel: 'diesel', consumption: null, co2: 132 }), ctx)!;
    expect(diesel.energyYear).toBeCloseTo((132 / 26.4) * 175 * 2.2);
    const guessed = costFields(car({ consumption: null, co2: null, powerKw: null, powerCv: null }), ctx);
    expect(guessed.runningYear).not.toBeNull();
    expect(guessed.costNote).toContain('potenza sconosciuta');
    expect(guessed.costNote).toContain('consumo stimato da peso e potenza');
    const ev = carCosts(car({ fuel: 'electric', consumption: null, consumptionUnit: null, weightKg: 1800 }), ctx)!;
    expect(ev.energyYear).toBeCloseTo((9 + 0.006 * 1800) * 1.1 * 175 * 0.3);
    expect(costFields(car({}), ctx).costGuessed).toBe(false);
    expect(guessed.costGuessed).toBe(true);
  });

  it('senza versione o senza prezzo: niente totali, con il motivo', () => {
    expect(costFields(car({ variantId: null }), ctx).runningYear).toBeNull();
    expect(costFields(car({ listPrice: null }), ctx).total10).toBeNull();
    expect(costFields(car({ listPrice: null }), ctx).running10).not.toBeNull();
    expect(costFields(car({ listPrice: null }), ctx).costNote).toContain('manca il prezzo: niente totali');
    expect(costFields(car({ variantId: null }), ctx).costNote).toBe('Versione non ancora ricercata');
  });
});
