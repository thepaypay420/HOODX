#!/bin/sh
set -e
cd "$(dirname "$0")/.."
ln -sfn web/app app
ln -sfn web/components components
ln -sfn web/lib lib
ln -sfn web/public public
