#!/bin/bash

# Dynamic Maps Setup Script for Aero Dynamic Window
echo "🗺️  Setting up Dynamic Maps Integration..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ Created .env file"
else
    echo "✅ .env file already exists"
fi

echo ""
echo "🔑 NEXT STEPS:"
echo "1. Get your FREE Bing Maps API key:"
echo "   → https://www.microsoft.com/en-us/maps/create-a-bing-maps-key"
echo ""
echo "2. Add your API key to .env file:"
echo "   VITE_BING_MAPS_API_KEY=your-api-key-here"
echo ""
echo "3. Restart development server:"
echo "   npm run dev"
echo ""
echo "🚀 Your dynamic maps will be ready to use!"
echo ""
echo "📊 Optional: Get Mapbox token for enhanced features:"
echo "   → https://account.mapbox.com/access-tokens/"
echo "   VITE_MAPBOX_TOKEN=your-token-here"