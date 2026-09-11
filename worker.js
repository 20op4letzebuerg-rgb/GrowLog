export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    try {
      if (!env.GOVEE_API_KEY) {
        return jsonResponse(
          { error: "GOVEE_API_KEY fehlt im Worker." },
          500,
          corsHeaders
        );
      }

      const devicesResponse = await fetch(
        "https://openapi.api.govee.com/router/api/v1/user/devices",
        {
          headers: {
            "Content-Type": "application/json",
            "Govee-API-Key": env.GOVEE_API_KEY
          }
        }
      );

      if (!devicesResponse.ok) {
        const text = await devicesResponse.text();

        return jsonResponse(
          {
            error: "Govee-Geräteliste konnte nicht geladen werden.",
            status: devicesResponse.status,
            details: text
          },
          502,
          corsHeaders
        );
      }

      const devicesData = await devicesResponse.json();
      const devices = devicesData.data || [];

      const sensor = devices.find(device => {
        const capabilities = device.capabilities || [];

        const hasTemperature = capabilities.some(
          capability => capability.instance === "sensorTemperature"
        );

        const hasHumidity = capabilities.some(
          capability => capability.instance === "sensorHumidity"
        );

        return hasTemperature && hasHumidity;
      });

      if (!sensor) {
        return jsonResponse(
          {
            error: "Kein kompatibler Govee Temperatur-/Feuchtigkeitssensor gefunden.",
            devices: devices.map(device => ({
              name: device.deviceName,
              sku: device.sku,
              type: device.type
            }))
          },
          404,
          corsHeaders
        );
      }

      const stateResponse = await fetch(
        "https://openapi.api.govee.com/router/api/v1/device/state",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Govee-API-Key": env.GOVEE_API_KEY
          },
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            payload: {
              sku: sensor.sku,
              device: sensor.device
            }
          })
        }
      );

      if (!stateResponse.ok) {
        const text = await stateResponse.text();

        return jsonResponse(
          {
            error: "Govee-Sensorstatus konnte nicht geladen werden.",
            status: stateResponse.status,
            details: text
          },
          502,
          corsHeaders
        );
      }

      const stateData = await stateResponse.json();

      const capabilities =
        stateData.payload?.capabilities || [];

      const temperatureCapability = capabilities.find(
        capability => capability.instance === "sensorTemperature"
      );

      const humidityCapability = capabilities.find(
        capability => capability.instance === "sensorHumidity"
      );

      const temperature = extractNumber(
        temperatureCapability?.state?.value
      );

      const humidity = extractNumber(
        humidityCapability?.state?.value
      );

      return jsonResponse(
        {
          success: true,
          deviceName: sensor.deviceName || "Govee Sensor",
          sku: sensor.sku,
          temperature,
          humidity,
          updatedAt: new Date().toISOString()
        },
        200,
        corsHeaders
      );

    } catch (error) {
      return jsonResponse(
        {
          error: "Unerwarteter Fehler.",
          details: String(error)
        },
        500,
        corsHeaders
      );
    }
  }
};

function extractNumber(value) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const number = parseFloat(value.replace(",", "."));
    return Number.isFinite(number) ? number : null;
  }

  if (value && typeof value === "object") {
    if (typeof value.value === "number") {
      return value.value;
    }

    if (typeof value.temperature === "number") {
      return value.temperature;
    }

    if (typeof value.humidity === "number") {
      return value.humidity;
    }
  }

  return null;
}

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}
