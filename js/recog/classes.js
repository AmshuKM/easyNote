// Class order is fixed and shared with training (Task 8); never reorder.
export const CLASSES = [
  ...'0123456789',
  ...'+-×÷=()/.^√π',
  ...'abcxyfghsinotleqr',
  'REJECT',
];

export const labelIndex = (label) => CLASSES.indexOf(label);
