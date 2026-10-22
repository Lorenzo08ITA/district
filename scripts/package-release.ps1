param([string]$OutputPath = '.artifacts/district-source.zip')
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archivePath = [IO.Path]::GetFullPath((Join-Path $workspace $OutputPath))
if (-not $archivePath.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The release archive must remain inside the workspace.'
}
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($archivePath)) | Out-Null
$rootFiles = @('package.json','package-lock.json','tsconfig.json','tsconfig.base.json','tsconfig.rts.json','next-env.d.ts','next.config.mjs','vitest.config.ts','playwright.config.ts','playwright.offline.config.ts','Dockerfile','compose.yaml','.dockerignore','.env.example','.prettierrc.json','.prettierignore','.gitignore','README.md')
$directories = @('data','app','components','games','lib','packages','public','scripts','server','tests','docs','.github')
$files = [Collections.Generic.List[string]]::new()
foreach ($name in $rootFiles) {
  $candidate = Join-Path $workspace $name
  if (Test-Path -LiteralPath $candidate -PathType Leaf) { $files.Add($candidate) }
}
foreach ($directory in $directories) {
  $path = Join-Path $workspace $directory
  foreach ($file in Get-ChildItem -LiteralPath $path -File -Recurse) {
    $relative = [IO.Path]::GetRelativePath($workspace,$file.FullName).Replace('\','/')
    if ($relative -match '(^|/)(node_modules|dist|\.git|\.next|\.data|screenshots|generated)(/|$)' -or $relative -match '\.tsbuildinfo$' -or $file.Name -eq '.env' -or $file.Name -like '.env.*') { continue }
    $files.Add($file.FullName)
  }
}
Add-Type -AssemblyName System.IO.Compression
$stream = [IO.File]::Open($archivePath,[IO.FileMode]::Create,[IO.FileAccess]::Write)
$archive = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
try {
  foreach ($file in ($files | Sort-Object)) {
    $relative = [IO.Path]::GetRelativePath($workspace,$file).Replace('\','/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file,$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose(); $stream.Dispose() }
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($archivePath + '.sha256',$hash + '  ' + [IO.Path]::GetFileName($archivePath) + [Environment]::NewLine)
Write-Output ('Archive: ' + $archivePath)
Write-Output ('Files: ' + $files.Count + '; bytes: ' + (Get-Item -LiteralPath $archivePath).Length)
Write-Output ('SHA256: ' + $hash)
