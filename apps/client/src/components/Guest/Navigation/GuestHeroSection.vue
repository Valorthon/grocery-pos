<template>
    <section class="hero-section">
        <div class="hero-overlay" />
        <v-container class="hero-content">
            <v-row justify="start" align="center" style="min-height: 80vh">
                <v-col cols="12" md="8" class="text-start">
                    <h1 class="hero-title mb-4">Efficient Store Management</h1>

                    <p class="text-body-1 text-white opacity-80 mb-8">
                        Manage inventory, process sales, and track restocks —
                        <br class="d-none d-md-block" />
                        all in one modern POS solution built for grocery
                        businesses.
                    </p>

                    <v-row density="compact" align="center" class="ga-2 pb-4">
                        <v-col cols="auto">
                            <v-btn
                                color="white"
                                size="large"
                                rounded="lg"
                                variant="flat"
                                min-width="180"
                                to="/login"
                            >
                                Get Started
                            </v-btn>
                        </v-col>
                    </v-row>
                </v-col>
            </v-row>
        </v-container>
    </section>
</template>
<script setup lang="ts"></script>
<style scoped>
.hero-section {
    min-height: 70vh;
    background: url('https://images.unsplash.com/photo-1542838132-92c53300491e?w=1600')
        center/cover no-repeat;
    position: relative;
    display: flex;
    align-items: center;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.hero-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
        90deg,
        rgba(10, 48, 60, 0.88) 15%,
        rgba(10, 48, 60, 0.3) 50%
    );
}

.hero-content {
    position: relative;
    z-index: 2;
}

.hero-title {
    font-size: clamp(2.2rem, 5vw, 3.4rem);
    font-weight: 800;
    color: white;
    line-height: 1.1;
}
</style>
