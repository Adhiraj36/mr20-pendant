// Stands in for electron so the main-process modules can be exercised in plain
// node. Only the two members they actually touch.
export const app = {
  isPackaged: false,
  getAppPath: () => process.env.ITEST_APP_ROOT ?? process.cwd(),
}
