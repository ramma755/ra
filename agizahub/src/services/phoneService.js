const normalisePhone = (raw) => {
  let phone = String(raw || "").replace(/[\s\-().]/g, "");
  if (!phone) return null;
  if (phone.startsWith("+")) phone = phone.slice(1);

  // Already canonical: 2547XXXXXXXX or 2541XXXXXXXX
  if (/^254[71]\d{8}$/.test(phone)) return phone;

  // 07XXXXXXXX or 01XXXXXXXX -> 2547XXXXXXXX / 2541XXXXXXXX
  if (/^0[71]\d{8}$/.test(phone)) return `254${phone.slice(1)}`;

  // 7XXXXXXXX or 1XXXXXXXX -> prepend 254
  if (/^[71]\d{8}$/.test(phone)) return `254${phone}`;

  return null;
};

const validateAndNormalise = (input) => {
  const normalised = normalisePhone(input);
  if (!normalised) {
    return {
      valid: false,
      message: "Invalid phone number. Send 0712345678 or +254712345678.",
    };
  }
  return {
    valid: true,
    phone: normalised,
  };
};

module.exports = {
  normalisePhone,
  validateAndNormalise,
};
