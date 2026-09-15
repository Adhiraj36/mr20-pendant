// Refuse to package an app whose engine is missing or is for another chip.
//
// electron-builder happily produced an x64 DMG carrying an arm64 daemon: it
// copies `resources/karmax-*` by glob, so whatever happened to be there went
// into every architecture. An Intel Mac would have installed it and found no
// engine at all — daemonBinary() looks for karmax-darwin-x64 by name, finds
// nothing, and the app says the build shipped without one.
//
// A DMG that installs and cannot start is worse than a build that failed, so
// this fails the build instead. It runs as electron-builder's afterPack hook,
// once per packaged architecture, with the app directory it just wrote.
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export default async function afterPack(context) {
  const { appOutDir, packager, arch } = context
  const platform = packager.platform.nodeName // darwin | win32 | linux
  const archName = context.arch === 1 ? 'x64' : context.arch === 3 ? 'arm64' : String(arch)

  const core =
    platform === 'darwin'
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources', 'core')
      : path.join(appOutDir, 'resources', 'core')

  const want = `karmax-${platform}-${archName}${platform === 'win32' ? '.exe' : ''}`

  let present
  try {
    present = readdirSync(core)
  } catch {
    throw new Error(
      `no engine in the ${archName} build (${core} does not exist).\n` +
        `Run scripts/build-core.sh ${platform}/${archName === 'x64' ? 'amd64' : archName} first.`,
    )
  }

  if (!present.includes(want)) {
    throw new Error(
      `the ${archName} build carries [${present.join(', ')}] but needs ${want}.\n` +
        `An app without its own engine installs and then cannot start, which is worse than a build that failed.\n` +
        `Run scripts/build-core.sh ${platform}/${archName === 'x64' ? 'amd64' : archName} first.`,
    )
  }

  // A binary of the right name can still be for the wrong chip: the name comes
  // from whoever wrote the file, and the last build wrote both under one name
  // by copying a glob.
  const binary = path.join(core, want)
  if (!statSync(binary).isFile()) throw new Error(`${binary} is not a file`)
  if (platform === 'darwin') {
    const described = execFileSync('file', ['-b', binary], { encoding: 'utf8' })
    const expected = archName === 'arm64' ? 'arm64' : 'x86_64'
    if (!described.includes(expected)) {
      throw new Error(
        `the ${archName} build's engine is not for ${archName}: file(1) says "${described.trim()}".`,
      )
    }
  }

  // Anything for another architecture is dead weight in the download and, more
  // to the point, evidence that the glob copied whatever was lying around.
  const strays = present.filter((f) => f.startsWith('karmax-') && f !== want)
  if (strays.length > 0) {
    throw new Error(
      `the ${archName} build also carries [${strays.join(', ')}].\n` +
        `extraResources copies resources/karmax-* by glob, so every architecture gets every binary.\n` +
        `Filter it per architecture, or build one at a time.`,
    )
  }

  console.log(`  • engine checked  arch=${archName} file=${want}`)
}
