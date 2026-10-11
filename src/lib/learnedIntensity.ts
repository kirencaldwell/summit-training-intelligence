/**
 * Where the app keeps the athlete's learned intensity model, if there is one. This is a leaf module (it imports
 * nothing from the training maths) so `resolveTss` can ask for a prediction without a circular import: the model
 * itself, which needs the training maths to build its features, lives in intensityModel.ts.
 */
import type { Activity } from '../types';

export interface LearnedPrediction {
  /** Predicted intensity factor (1.0 = threshold effort for the whole activity) */
  intensityFactor: number;
  /** Typical error of this kind of prediction, in intensity-factor units, measured on held-out activities */
  sigma: number;
}

export interface LoadInputs {
  ftp?: number;
  lthr?: number;
  weight_kg?: number;
}

export interface ActiveIntensityModel {
  /** A prediction, or undefined when the model isn't trusted for this kind of activity */
  predict(activity: Activity, profile?: LoadInputs): LearnedPrediction | undefined;
}

let active: ActiveIntensityModel | null = null;

export const getActiveIntensityModel = (): ActiveIntensityModel | null => active;
export const setActiveIntensityModel = (model: ActiveIntensityModel | null): void => {
  active = model;
};
