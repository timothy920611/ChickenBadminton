/** Shared player input validation for manual entry and CSV import. */
export function validPlayerInput(name, gender, level) {
    return typeof name === 'string' && name.trim().length > 0 && name.length <= 80
        && ['男', '女'].includes(gender) && Number.isInteger(level) && level >= 1 && level <= 18;
}

export function parsePlayersCsv(text, existing = [], maximum = 20) {
    const names = new Set(existing.map(player => player.name));
    const added = [];
    for (const line of text.split(/\r?\n/)) {
        const columns = line.trim().split(',');
        if (columns.length !== 3 || existing.length + added.length >= maximum) continue;
        const [name, gender, levelText] = columns.map(value => value.trim());
        const level = Number(levelText);
        if (!validPlayerInput(name, gender, level) || names.has(name)) continue;
        names.add(name);
        added.push({ id: crypto.randomUUID(), name, gender, level });
    }
    return added;
}
