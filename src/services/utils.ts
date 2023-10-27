import { isValidPhoneNumber } from "libphonenumber-js";

export const validatePlace = (
  data: any
): {
  dataValid: boolean;
  errors: {
    phoneInvalid: boolean;
  };
} => {
  const isPhoneValid = isValidPhoneNumber(data.contact_phone, "KE");
  return {
    dataValid: isPhoneValid,
    errors: {
      phoneInvalid: !isPhoneValid,
    },
  };
};
