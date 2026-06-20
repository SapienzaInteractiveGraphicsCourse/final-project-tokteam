import TWEEN from '@tweenjs/tween.js';

export const Easings = {
  SMOOTH: TWEEN.Easing.Quadratic.Out,   // lampposts, speed scroll
  FLY:    TWEEN.Easing.Cubic.InOut,     // camera fly-to
  RAMP:   TWEEN.Easing.Quadratic.InOut, // control panel lever
  COLOR:  TWEEN.Easing.Quadratic.Out,   // color transitions
};
