Get-ChildItem 'output' -Directory | ForEach-Object {
  $slug = $_.Name
  $files = Get-ChildItem ("output\$slug") -File
  $count = $files.Count
  Write-Host "=== $slug === ($count files)"
  $files | ForEach-Object {
    Write-Host "  $($_.Name)"
  }
}