/**
 * Where this run keeps its files. The shell owns the home a run goes under — a development run can be
 * pointed somewhere else, so it cannot change the files an installed app is using — and hands these over
 * before Core starts.
 */
export const paths = { config: '', storage: '', resources: '', node: '' };