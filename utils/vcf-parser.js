/**
 * VCF/vCard Parser — client-side parsing of vCard contact strings.
 */

window.VCFParser = {

  /**
   * Check if text looks like a vCard.
   */
  isVCF(text) {
    const t = text.trim().toUpperCase();
    return t.startsWith('BEGIN:VCARD') && t.includes('END:VCARD');
  },

  /**
   * Parse a vCard string into a contact object.
   * @param {string} text - Raw vCard text
   * @returns {Object} Parsed contact data
   */
  parse(text) {
    const lines = text.replace(/\r\n /g, '').replace(/\r\n\t/g, '').split(/\r?\n/);
    const contact = {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      organization: '',
      title: '',
      address: '',
      website: '',
      notes: ''
    };

    for (const raw of lines) {
      // Strip group prefixes (e.g., "item1.TEL:...")
      const line = raw.replace(/^[^.]+\./, '');
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const propPart = line.substring(0, colonIdx).toUpperCase();
      const value = line.substring(colonIdx + 1).trim();
      // Get the property name without parameters (e.g., "TEL;TYPE=WORK" → "TEL")
      const prop = propPart.split(';')[0];

      switch (prop) {
        case 'N': {
          // N:Last;First;Middle;Prefix;Suffix
          const parts = value.split(';');
          contact.lastName = parts[0] || '';
          contact.firstName = parts[1] || '';
          if (parts[3]) contact.firstName = parts[3] + ' ' + contact.firstName; // prefix
          break;
        }
        case 'FN':
          // Full name — use as fallback if N wasn't parsed well
          if (!contact.firstName && !contact.lastName) {
            const parts = value.split(' ');
            contact.firstName = parts[0] || '';
            contact.lastName = parts.slice(1).join(' ') || '';
          }
          break;
        case 'EMAIL':
          if (!contact.email) contact.email = value;
          break;
        case 'TEL':
          if (!contact.phone) contact.phone = value;
          break;
        case 'ORG':
          contact.organization = value.replace(/;/g, ' — ').trim();
          break;
        case 'TITLE':
          contact.title = value;
          break;
        case 'ADR': {
          // ADR:PO;Extended;Street;City;State;Zip;Country
          const adrParts = value.split(';').filter(Boolean);
          contact.address = adrParts.join(', ');
          break;
        }
        case 'URL':
          if (!contact.website) contact.website = value;
          break;
        case 'NOTE':
          contact.notes = value.replace(/\\n/g, '\n');
          break;
      }
    }

    if (!contact.firstName && !contact.lastName && !contact.email) {
      throw new Error('Could not extract any contact info from vCard.');
    }

    return contact;
  }
};
